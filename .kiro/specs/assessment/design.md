# Assessment Module — Design

## API endpoints

```
GET    /api/v1/assessment/activities/:id/submissions     — all submissions for an activity (teacher review)
PATCH  /api/v1/assessment/submissions/:id                — update status + text/audio feedback
POST   /api/v1/assessment/submissions/:id/annotate       — save annotation JSON for a block
GET    /api/v1/assessment/submissions/:id/annotation/:blockId
GET    /api/v1/assessment/classes/:classId/analytics     — class-level performance stats
GET    /api/v1/assessment/students/:studentId/progress   — per-student standard progress
```

## File structure

```
src/modules/assessment/
  dto/
    teacher-feedback.dto.ts
    save-annotation.dto.ts
  assessment.module.ts
  assessment.controller.ts
  assessment.service.ts
  assessment.service.spec.ts
  index.ts

apps/web/components/assessment/
  SubmissionReviewPanel.tsx    — full split-panel layout
  FeedbackPanel.tsx            — text + voice feedback + approve/return
  ClassAnalyticsDashboard.tsx  — charts
  StudentProgressView.tsx
```

## Review panel layout

```
┌──────────────────────┬───────────────────────────────────┐
│  Student response    │  Feedback panel                   │
│  (40% width)         │  (60% width)                      │
│                      │                                   │
│  Renders each block  │  • Text feedback textarea         │
│  in read-only mode   │  • Voice feedback recorder        │
│  (DrawingCanvas      │  • Annotation toggle              │
│   readOnly=true)     │  • Return / Approve buttons       │
│                      │  • Auto-grade score display       │
│  ← prev  next →      │                                   │
└──────────────────────┴───────────────────────────────────┘
```

## Analytics data

Class analytics (Prisma aggregations):
- `submissionRate` = SUBMITTED+APPROVED count / total assignments × 100
- `averageScore` = AVG(submission.score) where score IS NOT NULL
- `scoreDistribution` = histogram buckets: 0–25%, 26–50%, 51–75%, 76–100%

Student progress:
- Submissions over time (last 30 days, grouped by week)
- Per-standards-tag mastery % (correct blocks / total blocks for that tag)

## Key dependencies

- `recharts` — bar chart, progress ring (frontend)
- Reuses DrawingCanvas with `readOnly={true}` prop for annotation overlay
