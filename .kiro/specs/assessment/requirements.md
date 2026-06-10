# Assessment Module — Full Spec

## Requirements

Teachers review student submissions, leave text and voice feedback, annotate
drawings, and approve or return work. Auto-graded questions show scores instantly.

## API endpoints
```
GET    /api/v1/assessment/activities/:id/submissions  — all submissions for review
PATCH  /api/v1/assessment/submissions/:id             — update status + feedback
POST   /api/v1/assessment/submissions/:id/annotate    — save teacher annotation JSON per block
GET    /api/v1/assessment/submissions/:id/annotation/:blockId
GET    /api/v1/assessment/classes/:classId/analytics  — class-level performance stats
GET    /api/v1/assessment/students/:studentId/progress — per-student standard progress
```

## Review panel layout
- Left 40%: student response viewer (renders each block type, readOnly DrawingCanvas for drawings)
- Right 60%: feedback panel (text feedback, voice recorder, annotation toggle, approve/return buttons)
- Navigation: prev/next student arrows

## Analytics
- Per-activity: submission rate, average score, score distribution histogram
- Per-student: submissions over time, standard mastery percentage

## Tasks
- [ ] Task 1: AssessmentService — getAllSubmissions, updateFeedback, saveAnnotation, getAnalytics
- [ ] Task 2: AssessmentController — endpoints + school admin visibility on teacher-student messages
- [ ] Task 3: Frontend — SubmissionReviewPanel (full layout, all block types rendered)
- [ ] Task 4: Frontend — FeedbackPanel (text, voice recorder, annotation mode)
- [ ] Task 5: Frontend — ClassAnalyticsDashboard (Recharts — bar chart, progress rings)
- [ ] Task 6: Unit tests
