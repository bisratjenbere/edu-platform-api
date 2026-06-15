# Reading Fluency Assessment Module — Design

## Architecture

```
POST /api/v1/fluency/assessments                    → FluencyController → FluencyService.create()
POST /api/v1/fluency/assessments/:id/recording      → FluencyController → FluencyService.submitRecording()
GET  /api/v1/fluency/assessments/:id                → FluencyController → FluencyService.getAssessment()
GET  /api/v1/fluency/class/:classId                 → FluencyController → FluencyService.getByClass()
```

---

## Data model (already in database-schema.md)

```prisma
model FluencyAssessment {
  id            String        @id @default(uuid())
  student_id    String
  teacher_id    String
  class_id      String
  passage_text  String
  recording_url String?
  transcript    String?
  analysis      Json?         // FluencyAnalysisResult stored as JSON
  status        FluencyStatus @default(PENDING)
  created_at    DateTime      @default(now())
  updated_at    DateTime      @updatedAt
}
```

No schema changes needed. The `analysis` JSON column stores the full `FluencyAnalysisResult`.

---

## TypeScript interfaces

```typescript
// Stored in FluencyAssessment.analysis JSON column
interface FluencyAnalysisResult {
  wpm: number;                          // words per minute, integer
  accuracy: number;                     // 0-100, 1 decimal
  fluencyScore: number;                 // 0-100, 1 decimal
  recordingDurationSeconds: number;
  totalPassageWords: number;
  correctWords: number;
  mispronounced: MispronouncedWord[];
  omitted: string[];                    // passage words missing from transcript
  added: string[];                      // transcript words not in passage
  passageAnnotated: AnnotatedWord[];    // for teacher UI rendering
  transcriptAnnotated: AnnotatedWord[];
}

interface MispronouncedWord {
  passageWord: string;
  heardWord: string;
  index: number;                        // position in passage (0-based)
}

interface AnnotatedWord {
  word: string;
  status: 'correct' | 'mispronounced' | 'omitted' | 'added';
}

// Grade-level WPM benchmarks
const GRADE_WPM_BENCHMARK: Record<GradeLevel, number> = {
  PREK: 20, K: 30, G1: 60, G2: 90, G3: 110, G4: 130, G5: 150,
};
```

---

## BullMQ queue: `fluency-analysis`

```typescript
interface FluencyAnalysisJobPayload {
  assessmentId: string;
  studentId: string;
  teacherId: string;
  recordingUrl: string;   // S3 key (not signed URL — job fetches fresh signed URL)
  passageText: string;
  gradeLevel: GradeLevel; // from ClassStudent record, needed for WPM benchmark
}
```

- Queue name: `fluency-analysis`
- Concurrency: 3 (AWS Transcribe has per-account job limits)
- Retry: 2 retries on failure, then set status = ERROR
- On complete: emit `fluency-complete` WebSocket event to teacher room `class:{classId}`

---

## AWS Transcribe integration

```typescript
import {
  TranscribeClient,
  StartTranscriptionJobCommand,
  GetTranscriptionJobCommand,
  TranscriptionJobStatus,
} from '@aws-sdk/client-transcribe';

// Job naming: fluency-{assessmentId}-{timestamp}
// Media format: detected from recording_url extension (webm or mp4)
// Language: en-US (fixed — multi-language fluency is out of scope)
// Output: S3 bucket (same bucket, prefix 'transcribe-output/')

async function startTranscribeJob(assessmentId: string, s3Key: string): Promise<string> {
  const jobName = `fluency-${assessmentId}-${Date.now()}`;
  await transcribeClient.send(new StartTranscriptionJobCommand({
    TranscriptionJobName: jobName,
    MediaFormat: s3Key.endsWith('.webm') ? 'webm' : 'mp4',
    Media: { MediaFileUri: `s3://${process.env.S3_BUCKET_NAME}/${s3Key}` },
    OutputBucketName: process.env.S3_BUCKET_NAME,
    OutputKey: `transcribe-output/${assessmentId}.json`,
    LanguageCode: 'en-US',
  }));
  return jobName;
}

// Poll every 5s, timeout at 120s
async function pollTranscribeJob(jobName: string): Promise<string> {
  const maxAttempts = 24; // 24 × 5s = 120s
  for (let i = 0; i < maxAttempts; i++) {
    await sleep(5000);
    const { TranscriptionJob } = await transcribeClient.send(
      new GetTranscriptionJobCommand({ TranscriptionJobName: jobName })
    );
    if (TranscriptionJob?.TranscriptionJobStatus === TranscriptionJobStatus.COMPLETED) {
      return TranscriptionJob.Transcript?.TranscriptFileUri ?? '';
    }
    if (TranscriptionJob?.TranscriptionJobStatus === TranscriptionJobStatus.FAILED) {
      throw new Error(`Transcribe job failed: ${TranscriptionJob.FailureReason}`);
    }
  }
  throw new Error('Transcribe job timed out after 120 seconds');
}
```

---

## WordComparisonUtil — algorithm detail

```typescript
// Step 1: Normalise
function normalise(text: string): string[] {
  return text.toLowerCase().replace(/[^a-z0-9\s']/g, '').trim().split(/\s+/);
}

// Step 2: Levenshtein distance
function levenshtein(a: string, b: string): number {
  // Standard DP implementation — O(m×n)
  // Returns edit distance between two strings
}

// Step 3: LCS-based sequence alignment
// Match transcript words to passage words in order
// Returns alignment pairs: [{ passageIndex, transcriptIndex } | null]
function alignSequences(passage: string[], transcript: string[]): AlignedPair[] {
  // Uses longest-common-subsequence to find best word alignment
  // Words within Levenshtein distance ≤ 2 are considered a match
}

// Step 4: Classify each passage word
function classifyPassageWords(
  passage: string[],
  transcript: string[],
  alignment: AlignedPair[]
): AnnotatedWord[] {
  // aligned + distance=0 → correct
  // aligned + 0<distance≤2 + len>3 → mispronounced
  // not aligned → omitted
}

// Step 5: Classify each transcript word
function classifyTranscriptWords(
  transcript: string[],
  alignment: AlignedPair[]
): AnnotatedWord[] {
  // aligned (any distance) → correct or mispronounced
  // not aligned → added
}
```

---

## WebSocket event

- Namespace: `/fluency`
- Room: `class:{classId}` — teacher joins on FluencyPage open
- Event name: `fluency-complete`
- Payload: `{ assessmentId, studentId, fluencyScore, wpm, accuracy, status }`

---

## File structure

```
src/modules/fluency/
  dto/
    create-assessment.dto.ts
    submit-recording.dto.ts
    get-by-class-query.dto.ts
  fluency.module.ts
  fluency.controller.ts
  fluency.service.ts
  fluency.service.spec.ts
  fluency-analysis.job.ts
  fluency-analysis.job.spec.ts
  fluency.gateway.ts              — WebSocket namespace /fluency
  word-comparison.util.ts
  word-comparison.util.spec.ts    — most unit test coverage lives here
  index.ts

apps/web/components/fluency/
  FluencyAssessmentCard.tsx       — passage + transcript side-by-side with colour coding
  FluencyMetricsPanel.tsx         — WPM, accuracy, fluencyScore gauges
  FluencyClassList.tsx            — table of all students' results
```

---

## Environment variables required

```
AWS_REGION=                       # already present from Uploads module
AWS_ACCESS_KEY_ID=                # already present
AWS_SECRET_ACCESS_KEY=            # already present
S3_BUCKET_NAME=                   # already present
# Transcribe uses same AWS credentials — no additional keys needed
```

---

## Security and access control

- Teacher can only access assessments in their own classes (filter by class + ClassTeacher)
- Students can only see their own assessment (filter by student_id = req.user.id)
- Recording URL ownership: validate S3 key segment[1] === req.user.id before saving (student uploaded it)
- Transcribe output is stored in a private S3 prefix (`transcribe-output/`) — never served via CloudFront directly
- Analysis JSON is stripped of the raw transcript before serving to family members (families see only fluencyScore + wpm + accuracy — no word-level breakdown)