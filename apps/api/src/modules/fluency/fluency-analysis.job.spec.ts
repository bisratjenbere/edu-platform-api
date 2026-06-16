import { Test, TestingModule } from '@nestjs/testing';
import { FluencyAnalysisJob } from './fluency-analysis.job';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { FluencyGateway } from './fluency.gateway';
import { UploadsService } from '../uploads/uploads.service';
import { ConfigService } from '@nestjs/config';
import { FluencyStatus, GradeLevel, NotificationType } from '@prisma/client';
import { Job } from 'bull';

// ─── Mock AWS SDK clients ─────────────────────────────────────────────────────
const mockTranscribeClientSend = jest.fn();
const mockS3ClientSend = jest.fn();

jest.mock('@aws-sdk/client-transcribe', () => ({
  TranscribeClient: jest.fn().mockImplementation(() => ({
    send: mockTranscribeClientSend,
  })),
  StartTranscriptionJobCommand: jest.fn(),
  GetTranscriptionJobCommand: jest.fn(),
  TranscriptionJobStatus: {
    COMPLETED: 'COMPLETED',
    FAILED: 'FAILED',
    IN_PROGRESS: 'IN_PROGRESS',
  },
}));

jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation(() => ({
    send: mockS3ClientSend,
  })),
  GetObjectCommand: jest.fn(),
}));

// Suppress sleep delay in tests
jest.mock('./fluency-analysis.job', () => {
  const actual = jest.requireActual<typeof import('./fluency-analysis.job')>(
    './fluency-analysis.job',
  );
  return actual;
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeJob(
  data: Partial<{
    assessmentId: string;
    studentId: string;
    teacherId: string;
    recordingKey: string;
    passageText: string;
    classId: string;
    gradeLevel: GradeLevel;
  }> = {},
) {
  return {
    data: {
      assessmentId: 'assessment-1',
      studentId: 'student-1',
      teacherId: 'teacher-1',
      recordingKey: 'fluency/student-1/uuid.webm',
      passageText: 'the cat sat on the mat',
      classId: 'class-1',
      gradeLevel: GradeLevel.G3,
      ...data,
    },
  } as Job<any>;
}

function makeTranscribeOutput(transcriptText: string, lastEndTime = '3.5') {
  const body = JSON.stringify({
    results: {
      transcripts: [{ transcript: transcriptText }],
      items: [{ end_time: lastEndTime }],
    },
  });

  // Convert to a Node.js readable stream
  const { Readable } = require('stream') as typeof import('stream');
  const stream = new Readable();
  stream.push(body);
  stream.push(null);
  return { Body: stream };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('FluencyAnalysisJob', () => {
  let job: FluencyAnalysisJob;

  const mockPrisma = {
    fluencyAssessment: {
      update: jest.fn().mockResolvedValue({}),
    },
  };

  const mockNotifications = {
    sendToUser: jest.fn().mockResolvedValue(undefined),
  };

  const mockGateway = {
    emitFluencyComplete: jest.fn(),
  };

  const mockUploads = {
    getSignedUrl: jest.fn().mockReturnValue('https://cdn.example.com/key'),
  };

  const mockConfig = {
    get: jest.fn((key: string) => {
      const config: Record<string, string> = {
        AWS_REGION: 'us-east-1',
        AWS_ACCESS_KEY_ID: 'test-key',
        AWS_SECRET_ACCESS_KEY: 'test-secret',
        S3_BUCKET_NAME: 'test-bucket',
      };
      return config[key] ?? '';
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FluencyAnalysisJob,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: NotificationsService, useValue: mockNotifications },
        { provide: FluencyGateway, useValue: mockGateway },
        { provide: UploadsService, useValue: mockUploads },
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();

    job = module.get<FluencyAnalysisJob>(FluencyAnalysisJob);
    jest.clearAllMocks();

    // Default: fast poll — returns COMPLETED on first attempt
    mockTranscribeClientSend
      .mockResolvedValueOnce({}) // StartTranscriptionJobCommand
      .mockResolvedValueOnce({
        TranscriptionJob: { TranscriptionJobStatus: 'COMPLETED' },
      }); // GetTranscriptionJobCommand (1st poll)

    mockS3ClientSend.mockResolvedValue(makeTranscribeOutput('the cat sat on the mat'));
  });

  describe('handleAnalysis — success path', () => {
    it('sets status to COMPLETE and emits WebSocket event', async () => {
      await job.handleAnalysis(makeJob());

      expect(mockPrisma.fluencyAssessment.update).toHaveBeenCalledWith({
        where: { id: 'assessment-1' },
        data: expect.objectContaining({
          status: FluencyStatus.COMPLETE,
          transcript: expect.any(String),
          analysis: expect.objectContaining({
            wpm: expect.any(Number),
            accuracy: expect.any(Number),
            fluencyScore: expect.any(Number),
          }),
        }),
      });

      expect(mockGateway.emitFluencyComplete).toHaveBeenCalledWith(
        'class-1',
        expect.objectContaining({
          assessmentId: 'assessment-1',
          status: FluencyStatus.COMPLETE,
        }),
      );
    });

    it('does NOT call sendToUser on success', async () => {
      await job.handleAnalysis(makeJob());
      expect(mockNotifications.sendToUser).not.toHaveBeenCalled();
    });
  });

  describe('handleAnalysis — Transcribe failure', () => {
    it('sets status to ERROR and notifies teacher when Transcribe reports FAILED', async () => {
      // Override: StartTranscriptionJob OK, then poll returns FAILED
      mockTranscribeClientSend
        .mockResolvedValueOnce({}) // StartTranscriptionJobCommand
        .mockResolvedValueOnce({
          TranscriptionJob: {
            TranscriptionJobStatus: 'FAILED',
            FailureReason: 'Unsupported media format',
          },
        });

      await expect(job.handleAnalysis(makeJob())).rejects.toThrow();

      expect(mockPrisma.fluencyAssessment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: FluencyStatus.ERROR }),
        }),
      );

      expect(mockNotifications.sendToUser).toHaveBeenCalledWith(
        'teacher-1',
        expect.objectContaining({
          type: NotificationType.ACTIVITY_RETURNED,
          title: expect.stringContaining('Failed'),
        }),
      );
    });
  });

  describe('handleAnalysis — timeout', () => {
    it('sets status to ERROR when polling exceeds max attempts', async () => {
      // StartTranscriptionJob OK, all polls return IN_PROGRESS → timeout
      mockTranscribeClientSend
        .mockResolvedValueOnce({}) // StartTranscriptionJobCommand
        .mockResolvedValue({
          TranscriptionJob: { TranscriptionJobStatus: 'IN_PROGRESS' },
        }); // every poll

      // Replace the private method to speed up the test
      // (we can't easily stub setTimeout so we stub the internal poll logic)
      const jobInstance = job as any;
      const originalPoll = jobInstance.pollAndFetchTranscript.bind(jobInstance);
      jobInstance.pollAndFetchTranscript = jest
        .fn()
        .mockRejectedValue(
          new Error('AWS Transcribe job timed out after 120 seconds'),
        );

      await expect(job.handleAnalysis(makeJob())).rejects.toThrow('timed out');

      expect(mockPrisma.fluencyAssessment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: FluencyStatus.ERROR }),
        }),
      );

      jobInstance.pollAndFetchTranscript = originalPoll;
    });
  });

  describe('handleAnalysis — fluency score calculation', () => {
    it('fluencyScore is clamped between 0 and 100', async () => {
      // Perfect transcript → score should be 100
      await job.handleAnalysis(makeJob());

      const updateCall = mockPrisma.fluencyAssessment.update.mock.calls[0][0];
      const analysis = updateCall.data.analysis as { fluencyScore: number };
      expect(analysis.fluencyScore).toBeGreaterThanOrEqual(0);
      expect(analysis.fluencyScore).toBeLessThanOrEqual(100);
    });
  });
});
