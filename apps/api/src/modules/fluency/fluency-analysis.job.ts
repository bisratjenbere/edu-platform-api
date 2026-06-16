import { Processor, Process } from '@nestjs/bull';
import { Job } from 'bull';
import { Logger } from '@nestjs/common';
import {
  TranscribeClient,
  StartTranscriptionJobCommand,
  GetTranscriptionJobCommand,
  TranscriptionJobStatus,
} from '@aws-sdk/client-transcribe';
import {
  S3Client,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { FluencyGateway } from './fluency.gateway';
import { UploadsService } from '../uploads/uploads.service';
import { compareWords } from './word-comparison.util';
import { FluencyStatus, GradeLevel, NotificationType } from '@prisma/client';

// ─── Grade-level WPM benchmarks (from requirements.md) ──────────────────────
const GRADE_WPM_BENCHMARK: Record<GradeLevel, number> = {
  PREK: 20,
  K: 30,
  G1: 60,
  G2: 90,
  G3: 110,
  G4: 130,
  G5: 150,
};

// ─── Job payload shape (mirrors FluencyService.submitRecording) ──────────────
interface FluencyAnalysisJobPayload {
  assessmentId: string;
  studentId: string;
  teacherId: string;
  recordingKey: string;
  passageText: string;
  classId: string;
  gradeLevel: GradeLevel;
}

// ─── Processor ───────────────────────────────────────────────────────────────

@Processor('fluency-analysis')
export class FluencyAnalysisJob {
  private readonly logger = new Logger(FluencyAnalysisJob.name);
  private readonly transcribeClient: TranscribeClient;
  private readonly s3Client: S3Client;
  private readonly bucketName: string;

  constructor(
    private prisma: PrismaService,
    private notificationsService: NotificationsService,
    private fluencyGateway: FluencyGateway,
    private uploadsService: UploadsService,
    private configService: ConfigService,
  ) {
    const region = this.configService.get<string>('AWS_REGION') ?? 'us-east-1';
    const credentials = {
      accessKeyId: this.configService.get<string>('AWS_ACCESS_KEY_ID') ?? '',
      secretAccessKey:
        this.configService.get<string>('AWS_SECRET_ACCESS_KEY') ?? '',
    };

    this.transcribeClient = new TranscribeClient({ region, credentials });
    this.s3Client = new S3Client({ region, credentials, maxAttempts: 3 });
    this.bucketName =
      this.configService.get<string>('S3_BUCKET_NAME') ?? '';
  }

  @Process({ name: 'analyse', concurrency: 3 })
  async handleAnalysis(job: Job<FluencyAnalysisJobPayload>): Promise<void> {
    const { assessmentId, teacherId, recordingKey, passageText, classId, gradeLevel } =
      job.data;

    this.logger.log(`Starting fluency analysis for assessment ${assessmentId}`);

    try {
      // Step 1: Start AWS Transcribe job
      const jobName = `fluency-${assessmentId}-${Date.now()}`;
      const mediaFormat = recordingKey.endsWith('.webm') ? 'webm' : 'mp4';
      const outputKey = `transcribe-output/${assessmentId}.json`;

      await this.transcribeClient.send(
        new StartTranscriptionJobCommand({
          TranscriptionJobName: jobName,
          MediaFormat: mediaFormat,
          Media: {
            MediaFileUri: `s3://${this.bucketName}/${recordingKey}`,
          },
          OutputBucketName: this.bucketName,
          OutputKey: outputKey,
          LanguageCode: 'en-US',
          Settings: {
            ShowSpeakerLabels: false,
          },
        }),
      );

      // Step 2: Poll every 5 s, max 120 s
      const { transcriptText, durationSeconds } =
        await this.pollAndFetchTranscript(jobName, outputKey);

      // Step 3: Compare passage vs transcript
      const comparison = compareWords(passageText, transcriptText);

      // Step 4: Calculate WPM
      const wpm =
        durationSeconds > 0
          ? Math.round(comparison.correctWords / (durationSeconds / 60))
          : 0;

      // Step 5: Calculate composite fluency score
      const benchmark = GRADE_WPM_BENCHMARK[gradeLevel] ?? 110;
      const wpmScore = Math.min(wpm / benchmark, 1.0) * 100;
      const prosodyProxy =
        comparison.totalPassageWords > 0
          ? (1 -
              comparison.mispronounced.length /
                comparison.totalPassageWords) *
            100
          : 100;
      const fluencyScore =
        Math.round(
          (0.4 * comparison.accuracy +
            0.3 * wpmScore +
            0.3 * prosodyProxy) *
            10,
        ) / 10;

      // Step 6: Persist result
      const analysisResult = {
        wpm,
        accuracy: comparison.accuracy,
        fluencyScore: Math.max(0, Math.min(100, fluencyScore)),
        recordingDurationSeconds: durationSeconds,
        totalPassageWords: comparison.totalPassageWords,
        correctWords: comparison.correctWords,
        mispronounced: comparison.mispronounced,
        omitted: comparison.omitted,
        added: comparison.added,
        passageAnnotated: comparison.passageAnnotated,
        transcriptAnnotated: comparison.transcriptAnnotated,
      };

      await this.prisma.fluencyAssessment.update({
        where: { id: assessmentId },
        data: {
          transcript: transcriptText,
          analysis: analysisResult,
          status: FluencyStatus.COMPLETE,
        },
      });

      this.logger.log(
        `Fluency analysis complete: ${assessmentId} — score=${fluencyScore} wpm=${wpm} accuracy=${comparison.accuracy}`,
      );

      // Step 7: Notify teacher via WebSocket
      this.fluencyGateway.emitFluencyComplete(classId, {
        assessmentId,
        studentId: job.data.studentId,
        fluencyScore: analysisResult.fluencyScore,
        wpm,
        accuracy: comparison.accuracy,
        status: FluencyStatus.COMPLETE,
      });
    } catch (error: unknown) {
      const msg =
        error instanceof Error ? error.message : 'Unknown analysis error';

      this.logger.error(
        `Fluency analysis failed for assessment ${assessmentId}: ${msg}`,
        error instanceof Error ? error.stack : undefined,
      );

      // Mark assessment as ERROR
      await this.prisma.fluencyAssessment.update({
        where: { id: assessmentId },
        data: { status: FluencyStatus.ERROR },
      });

      // Notify teacher
      await this.notificationsService.sendToUser(teacherId, {
        type: NotificationType.ACTIVITY_RETURNED, // closest existing type for "assessment ready"
        title: 'Fluency Analysis Failed',
        body: 'A fluency analysis could not be completed. The student may re-submit a new recording.',
        data: { assessmentId },
      });

      throw error; // let BullMQ retry (2 attempts total per submitRecording config)
    }
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  /**
   * Poll AWS Transcribe every 5 s for up to 120 s.
   * Returns the plain-text transcript and duration in seconds.
   */
  private async pollAndFetchTranscript(
    jobName: string,
    outputKey: string,
  ): Promise<{ transcriptText: string; durationSeconds: number }> {
    const maxAttempts = 24; // 24 × 5 s = 120 s
    const pollIntervalMs = 5000;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      await sleep(pollIntervalMs);

      const { TranscriptionJob } = await this.transcribeClient.send(
        new GetTranscriptionJobCommand({ TranscriptionJobName: jobName }),
      );

      const status = TranscriptionJob?.TranscriptionJobStatus;

      if (status === TranscriptionJobStatus.COMPLETED) {
        return this.fetchTranscriptFromS3(outputKey);
      }

      if (status === TranscriptionJobStatus.FAILED) {
        throw new Error(
          `AWS Transcribe job failed: ${TranscriptionJob?.FailureReason ?? 'Unknown reason'}`,
        );
      }

      this.logger.debug(
        `Transcribe job ${jobName} status: ${status} (attempt ${attempt + 1}/${maxAttempts})`,
      );
    }

    throw new Error('AWS Transcribe job timed out after 120 seconds');
  }

  /**
   * Read the Transcribe JSON output from S3 and extract the plain-text transcript
   * plus the recording duration (from the Transcribe audio_segments metadata).
   */
  private async fetchTranscriptFromS3(
    outputKey: string,
  ): Promise<{ transcriptText: string; durationSeconds: number }> {
    const response = await this.s3Client.send(
      new GetObjectCommand({
        Bucket: this.bucketName,
        Key: outputKey,
      }),
    );

    const body = await streamToString(response.Body);
    const parsed = JSON.parse(body) as TranscribeOutput;

    const transcriptText =
      parsed.results?.transcripts?.[0]?.transcript ?? '';

    // Duration comes from the last item's end_time in audio_segments
    const items = parsed.results?.items ?? [];
    let durationSeconds = 0;
    if (items.length > 0) {
      const last = items[items.length - 1];
      durationSeconds = parseFloat(last.end_time ?? '0');
    }

    return { transcriptText, durationSeconds };
  }
}

// ─── AWS Transcribe output shape (minimal) ──────────────────────────────────

interface TranscribeOutput {
  results?: {
    transcripts?: Array<{ transcript: string }>;
    items?: Array<{ end_time?: string; start_time?: string; type?: string }>;
  };
}

// ─── Utilities ───────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function streamToString(
  stream: NodeJS.ReadableStream | ReadableStream | Blob | undefined,
): Promise<string> {
  if (!stream) return '';

  // Node.js readable stream (AWS SDK v3 returns this in Node environments)
  if (typeof (stream as NodeJS.ReadableStream).pipe === 'function') {
    return new Promise<string>((resolve, reject) => {
      const chunks: Buffer[] = [];
      (stream as NodeJS.ReadableStream).on('data', (chunk: Buffer) =>
        chunks.push(chunk),
      );
      (stream as NodeJS.ReadableStream).on('end', () =>
        resolve(Buffer.concat(chunks).toString('utf-8')),
      );
      (stream as NodeJS.ReadableStream).on('error', reject);
    });
  }

  // Blob (browser / test environments)
  if (stream instanceof Blob) {
    return stream.text();
  }

  return '';
}
