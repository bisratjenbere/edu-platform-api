# Reading Fluency Assessment Module — Tasks

## Prerequisites
- Auth module complete (JwtAuthGuard, RolesGuard)
- Uploads module complete (UploadsService.getSignedUrl available)
- Classes module complete (ClassStudent with gradeLevel linkable)
- Notifications module complete (to notify teacher on analysis error)

## Implementation order (follow this sequence exactly)

- [ ] Task 1: DTOs
  - `create-assessment.dto.ts`
    - class_id: IsUUID
    - student_id: IsUUID
    - passage_text: IsString, MinLength(1), custom validator `@IsWordCountBetween(20, 500)`
    - Implement `IsWordCountBetween` custom validator using class-validator `registerDecorator`
  - `submit-recording.dto.ts`
    - recording_key: IsString — S3 key (not URL), matches key format regex
  - `get-by-class-query.dto.ts`
    - studentId: IsOptional, IsUUID
    - status: IsOptional, IsEnum(FluencyStatus)

- [ ] Task 2: WordComparisonUtil — implement and test first
  - `normalise(text)` — lowercase, strip punctuation, split on whitespace
  - `levenshtein(a, b)` — standard DP, O(m×n), returns integer distance
  - `alignSequences(passage, transcript)` — LCS-based alignment returning AlignedPair[]
  - `classifyPassageWords(passage, transcript, alignment)` → AnnotatedWord[]
  - `classifyTranscriptWords(transcript, alignment)` → AnnotatedWord[]
  - `compareWords(passageText, transcriptText)` → full FluencyAnalysisResult (without wpm/score — those need duration)
  - **This is the highest-value unit test target in the entire module — write tests first (TDD)**
  - Test cases for word-comparison.util.spec.ts:
    - Perfect reading: all words correct
    - One mispronounced word (distance ≤ 2): flagged as mispronounced
    - One omitted word: detected as omitted
    - One added word: detected as added
    - Multiple consecutive omissions: all detected
    - Student reads extra words at end: correctly marked as added
    - Short word (len ≤ 3) with distance 1: treated as different word, NOT mispronounced
    - Case and punctuation normalisation: "Hello," matches "hello"

- [ ] Task 3: FluencyService — core methods
  - `create(teacherId, dto)`:
    - Validate word count (20–500) — throw BadRequestException with specific message
    - Verify teacher is ClassTeacher for dto.class_id
    - Verify student is ClassStudent for dto.class_id
    - Create FluencyAssessment(status=PENDING)
    - Return assessment
  - `submitRecording(assessmentId, studentId, dto)`:
    - Verify assessment exists and belongs to studentId
    - Verify status is PENDING — throw ConflictException if PROCESSING or COMPLETE
    - Verify S3 key ownership (segment[1] === studentId)
    - Update recording_url, set status=PROCESSING
    - Enqueue FluencyAnalysisJob with full payload
    - Return updated assessment
  - `getAssessment(assessmentId, requesterId, requesterRole)`:
    - TEACHER: verify ClassTeacher for assessment.class_id
    - STUDENT: verify assessmentId.student_id === requesterId
    - Return assessment with analysis JSON
  - `getByClass(classId, teacherId, query)`:
    - Verify ClassTeacher for classId
    - Apply optional studentId and status filters
    - Order by created_at DESC
    - Return list with student name joined

- [ ] Task 4: FluencyAnalysisJob — BullMQ processor
  - Process `fluency-analysis` queue with concurrency 3
  - Step 1: Get fresh signed URL for recording via `UploadsService.getSignedUrl(recordingKey)`
  - Step 2: Start AWS Transcribe job (see design.md for command setup)
  - Step 3: Poll every 5s, max 120s, using `pollTranscribeJob()`
  - Step 4: Fetch transcript JSON from S3 output
  - Step 5: Extract plain text from Transcribe output and recording duration (from Transcribe metadata)
  - Step 6: Call `WordComparisonUtil.compareWords(passageText, transcriptText)`
  - Step 7: Calculate wpm = Math.round(correctWords / (durationSeconds / 60))
  - Step 8: Calculate wpm_score, prosody_proxy, fluencyScore using formula from requirements
  - Step 9: Update FluencyAssessment: transcript, analysis (FluencyAnalysisResult), status=COMPLETE
  - Step 10: Emit `fluency-complete` WebSocket event via FluencyGateway
  - On any error: set status=ERROR, send notification to teacher via NotificationsService
  - Unit tests: successful end-to-end (mock Transcribe), Transcribe failure → status=ERROR, timeout → status=ERROR, WebSocket event emitted on success

- [ ] Task 5: FluencyGateway — WebSocket
  - Namespace: `/fluency`
  - `@SubscribeMessage('join-class')` — teacher joins room `class:{classId}` (verify ClassTeacher)
  - `emitFluencyComplete(classId, payload)` — called by FluencyAnalysisJob on completion
  - Export `FluencyGateway` for injection in FluencyAnalysisJob

- [ ] Task 6: FluencyController — all endpoints
  - POST /api/v1/fluency/assessments → @Roles(TEACHER)
  - POST /api/v1/fluency/assessments/:id/recording → @Roles(STUDENT)
  - GET  /api/v1/fluency/assessments/:id → @Roles(TEACHER, STUDENT)
  - GET  /api/v1/fluency/class/:classId → @Roles(TEACHER)
  - All endpoints: @UseGuards(JwtAuthGuard, RolesGuard)
  - Full OpenAPI decorators

- [ ] Task 7: Frontend — FluencyAssessmentCard
  - Split view: left = passage with colour-coded words, right = transcript with colour-coded words
  - Colour coding: green = correct, orange = mispronounced, red = omitted (passage) / purple = added (transcript)
  - Hover on mispronounced word shows tooltip: "heard as: {heardWord}"
  - No interactive controls — read-only display

- [ ] Task 8: Frontend — FluencyMetricsPanel
  - Three gauge/ring charts (Recharts RadialBarChart): WPM, Accuracy %, Fluency Score
  - WPM gauge shows student value vs grade benchmark (e.g. "87 / 110 WPM for Grade 3")
  - Status badge: PENDING | PROCESSING (with spinner) | COMPLETE | ERROR
  - On PROCESSING status: poll GET /api/v1/fluency/assessments/:id every 5s OR listen on WebSocket

- [ ] Task 9: Frontend — FluencyClassList
  - Table: student name, latest WPM, accuracy, fluency score, date, status
  - Sortable by fluency score and date
  - Click row → opens FluencyAssessmentCard + FluencyMetricsPanel in a drawer
  - Filter by student search input

- [ ] Task 10: Unit tests — full coverage
  - fluency.service.spec.ts — create (word count validation), submitRecording (status guard, ownership), getAssessment (RBAC)
  - fluency-analysis.job.spec.ts — success path, Transcribe failure, timeout, event emission
  - word-comparison.util.spec.ts — all 8 test cases from Task 2 (these are the highest-value tests)