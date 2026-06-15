# Submissions Module — Tasks

## Implementation order (follow this sequence exactly)

- [x] Task 1: DTOs
  - `update-submission-block.dto.ts` — block_id (IsUUID), response_content (IsObject)
  - `teacher-feedback.dto.ts` — status (IsEnum SubmissionStatus, only RETURNED/APPROVED allowed), feedback_text (IsString, optional, max 5000), feedback_audio_url (IsString, optional)

- [x] Task 2: SubmissionsService — core status transitions
  - `getInbox(studentId, classId?)` — return assigned activities with submission status, ordered by due_date ASC
  - `findOne(submissionId, requesterId)` — include all SubmissionBlocks, verify requester is student owner or class teacher
  - `start(submissionId, studentId)` — verify NOT_STARTED, set status = IN_PROGRESS, set started_at
  - `saveBlock(submissionId, studentId, dto)` — upsert SubmissionBlock.response_content, create SubmissionBlockRevision, verify IN_PROGRESS or RETURNED status
  - `submit(submissionId, studentId)` — verify IN_PROGRESS, set status = SUBMITTED, set submitted_at, trigger auto-grade, enqueue push notification (SUBMISSION_RECEIVED) to teacher, emit WebSocket event
  - `updateFeedback(submissionId, teacherId, dto)` — verify teacher owns activity's class, update status + feedback fields, enqueue push notification (ACTIVITY_RETURNED) to student if RETURNED

- [x] Task 3: AutoGradeService
  - `grade(submissionId)` — run after submit(), read all SubmissionBlocks, score each against ActivityBlock content
  - MULTIPLE_CHOICE: `score = selectedOptionId === correctOptionId ? 1 : 0`
  - TRUE_FALSE: `score = answer === correctAnswer ? 1 : 0`
  - DRAG_DROP: `score = correctPairs / totalPairs` (partial credit, round to 2 decimal places)
  - POLL / SHORT_ANSWER / OPEN_ENDED / instruction blocks: skip (score = null)
  - Update each SubmissionBlock.auto_score
  - Update Submission.score (sum of block scores) and Submission.max_score (count of gradeable blocks)
  - Full unit tests: all 3 question types, partial drag-drop, mixed block submission

- [x] Task 4: SubmissionsController — all endpoints
  - `@Roles(Role.STUDENT)` on start, saveBlock, submit
  - `@Roles(Role.TEACHER)` on updateFeedback, annotation
  - `@Roles(Role.STUDENT, Role.TEACHER, Role.FAMILY)` on GET endpoints (scoped by service)
  - Full OpenAPI decorators on every method

- [ ] Task 5: Frontend — DrawingCanvas (Fabric.js)
  - Tools: pencil, marker, highlighter, magic pen, eraser, text tool, color picker, stroke width slider
  - Background image support (from block backgroundImageUrl)
  - Undo/redo stack (max 50 states via useDrawingHistory hook)
  - Left-hand mode toggle (flips toolbar to right side)
  - Auto-save every 20s — serialise to Fabric JSON, upload via mediaUpload.service.ts
  - Export preview as data URL for thumbnail

- [ ] Task 6: Frontend — AudioRecorder
  - Live waveform visualization using Wavesurfer.js during recording
  - Max 5 minutes (300s) — countdown timer shown
  - Preview playback before submitting
  - Re-record button clears and restarts
  - Upload via mediaUpload.service.ts on confirm

- [ ] Task 7: Frontend — VideoRecorder
  - Live camera preview via getUserMedia
  - Auto-capture thumbnail at 1s mark using canvas
  - Max 5 minutes — countdown timer shown
  - Preview playback before submitting
  - Upload via mediaUpload.service.ts on confirm

- [ ] Task 8: Frontend — StudentInbox
  - Activity list ordered by due_date ASC
  - Status badges: New (grey) | In Progress (blue) | Submitted (green) | Returned (orange)
  - Overdue activities highlighted red (due_date < now and not SUBMITTED/APPROVED)
  - Skeleton loading state

- [ ] Task 9: Frontend — ActivityResponsePage
  - Renders each block type read-only (instruction blocks) or interactive (response blocks)
  - Block renderer components: DrawingCanvas, AudioRecorder, VideoRecorder, MultipleChoice, TrueFalse, DragDrop, ShortAnswer, OpenEnded
  - Auto-save indicator (saving… / saved / error)
  - Submit button (disabled until all required blocks have responses)

- [ ] Task 10: Integration — auto-grade + WebSocket
  - After submit(): call AutoGradeService.grade(), then emit `submission-updated` via SubmissionStatusGateway
  - Score display on StudentInbox card after grading completes
