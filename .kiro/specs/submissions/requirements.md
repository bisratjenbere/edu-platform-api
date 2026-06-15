# Submissions Module — Full Spec

## Requirements

### Overview
Students respond to assigned activities using multiple media types: drawing, audio,
video, photo, text, and file upload. The system auto-saves drafts and auto-grades
objective question types on submission.

### User stories

**US-SUB-01 — View assigned activities**
As a student, I want to see all activities assigned to me.
- Activities shown in my inbox ordered by due_date ASC
- Status badges: New | In Progress | Submitted | Returned
- Overdue activities highlighted in red

**US-SUB-02 — Drawing response**
As a student, I want to draw or write on a canvas to respond to an activity.
- Tools: pencil, marker, highlighter, magic pen, eraser, text, color picker, stroke width
- Background image support (teacher-provided prompt image)
- Undo/redo (max 50 states)
- Left-hand mode (toolbar switches side)
- Auto-save every 20 seconds

**US-SUB-03 — Audio response**
As a student, I want to record an audio response (max 5 minutes).
- Live waveform visualization during recording
- Preview before submitting
- Re-record option

**US-SUB-04 — Video response**
As a student, I want to record a video response (max 5 minutes).
- Live camera preview
- Auto-thumbnail at 1 second mark
- Preview before submitting

**US-SUB-05 — Submit response**
As a student, I want to submit my completed response to my teacher.
- WHEN I submit, status changes to SUBMITTED
- AND teacher receives push notification
- AND auto-grading runs immediately for MCQ/T-F/Drag-drop blocks
- AND my submission appears in teacher's submission status view within 5 seconds

**US-SUB-06 — Auto-grading**
As a student, I want to see my score immediately for objective questions.
- MULTIPLE_CHOICE: full credit if correct option selected
- TRUE_FALSE: full credit if correct answer selected
- DRAG_DROP: partial credit (correct pairs / total pairs)
- Score shown per block and as total after submission

**US-SUB-07 — Resubmit returned work**
As a student, I want to edit and resubmit work my teacher returned.
- WHEN teacher returns my submission, status = RETURNED
- AND I can edit all blocks and resubmit
- AND my revision history is preserved

---

## Design

### API endpoints
```
GET    /api/v1/submissions?studentId=&classId=    — student's inbox
GET    /api/v1/submissions/:id                    — full submission with blocks
POST   /api/v1/submissions/:id/start              — status → IN_PROGRESS
PATCH  /api/v1/submissions/:id/blocks/:blockId    — save block response (draft)
POST   /api/v1/submissions/:id/submit             — status → SUBMITTED, trigger auto-grade
PATCH  /api/v1/submissions/:id                    — teacher: update status/feedback
POST   /api/v1/submissions/:id/annotation         — teacher: save annotation JSON
GET    /api/v1/uploads/presigned-url              — get S3 presigned PUT URL
POST   /api/v1/uploads/confirm                    — confirm file uploaded to S3
```

### Auto-grade algorithm
```typescript
// Runs synchronously on submit
MULTIPLE_CHOICE: score = student.selectedIndex === block.correctIndex ? 1 : 0
TRUE_FALSE:      score = student.answer === block.correctAnswer ? 1 : 0
DRAG_DROP:       score = correctPairs / totalPairs  // partial credit
```

### File structure
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

src/modules/uploads/
  uploads.module.ts
  uploads.controller.ts
  uploads.service.ts

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

---

## Tasks

- [ ] Task 1: SubmissionsService — core CRUD + status transitions
- [ ] Task 2: AutoGradeService — all 3 question types + unit tests
- [ ] Task 3: UploadsService — S3 presigned URL generation + confirm
- [ ] Task 4: SubmissionsController — all endpoints
- [ ] Task 5: Frontend — DrawingCanvas (Fabric.js, all tools, undo/redo)
- [ ] Task 6: Frontend — AudioRecorder (waveform, preview, re-record)
- [ ] Task 7: Frontend — VideoRecorder (live preview, thumbnail)
- [ ] Task 8: Frontend — StudentInbox (activity list, status badges, due dates)
- [ ] Task 9: Frontend — ActivityResponsePage (renders each block type for response)
- [ ] Task 10: Integration — auto-grade on submit + WebSocket notification to teacher
