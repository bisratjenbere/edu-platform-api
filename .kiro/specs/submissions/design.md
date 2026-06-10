# Submissions Module — Design

## API endpoints

```
GET    /api/v1/submissions?studentId=&classId=     — student inbox
GET    /api/v1/submissions/:id                     — full submission with blocks
POST   /api/v1/submissions/:id/start               — status → IN_PROGRESS
PATCH  /api/v1/submissions/:id/blocks/:blockId     — save block response (auto-save)
POST   /api/v1/submissions/:id/submit              — status → SUBMITTED, trigger auto-grade
PATCH  /api/v1/submissions/:id                     — teacher: update status + feedback
POST   /api/v1/submissions/:id/annotation          — teacher: save annotation JSON per block
```

## File structure

```
src/modules/submissions/
  dto/
    update-submission-block.dto.ts
    teacher-feedback.dto.ts
  submissions.module.ts
  submissions.controller.ts
  submissions.service.ts
  submissions.service.spec.ts
  auto-grade.service.ts
  auto-grade.service.spec.ts
  index.ts

apps/web/components/
  canvas/
    DrawingCanvas.tsx
    DrawingToolbar.tsx
    useDrawingHistory.ts
  recording/
    AudioRecorder.tsx
    VideoRecorder.tsx
  submission/
    StudentInbox.tsx
    ActivityResponsePage.tsx
    SubmissionBlockRenderer.tsx
```

## Auto-grade algorithm

Runs synchronously inside `submit()` before returning the response:

```
MULTIPLE_CHOICE: score = student.selectedOptionId === block.correctOptionId ? 1 : 0
TRUE_FALSE:      score = student.answer === block.correctAnswer ? 1 : 0
DRAG_DROP:       score = correctPairs / totalPairs  (partial credit)
All others:      score = null (not graded)
```

Submission.score = sum of all non-null block scores
Submission.max_score = count of auto-gradeable blocks

## Revision history

Every `saveBlock()` call:
1. Upserts `SubmissionBlock.response_content` (latest value)
2. Creates a new `SubmissionBlockRevision` with incrementing `revision_number`

This satisfies US-SUB-07 (revision history preserved on resubmit).

## Key dependencies

- `fabric` — drawing canvas
- `wavesurfer.js` — audio waveform
- WebSocket: listens to `SubmissionStatusGateway` (defined in activities module)
