# Admin Portal Module — Design

## API endpoints

```
GET    /api/v1/admin/dashboard
GET    /api/v1/admin/teachers?page=&limit=
POST   /api/v1/admin/teachers
PATCH  /api/v1/admin/teachers/:id/deactivate
POST   /api/v1/admin/teachers/:id/reset-password
GET    /api/v1/admin/classes?page=&limit=
GET    /api/v1/admin/students?q=&page=&limit=
POST   /api/v1/admin/rosters/bulk-import      (multipart/form-data)
GET    /api/v1/admin/reports/engagement
POST   /api/v1/admin/export/student/:studentId
GET    /api/v1/admin/clever/sync-status
```

## File structure

```
src/modules/admin/
  dto/
    create-teacher.dto.ts
    reset-password.dto.ts
    bulk-import.dto.ts
  admin.module.ts
  admin.controller.ts
  admin.service.ts
  admin.service.spec.ts
  bulk-import.service.ts
  index.ts

src/modules/clever/
  clever-api.service.ts
  clever-roster-sync.job.ts
  clever.strategy.ts
  clever.controller.ts
  clever.module.ts

src/modules/fluency/
  dto/
    create-assessment.dto.ts
    save-recording.dto.ts
  fluency.module.ts
  fluency.controller.ts
  fluency.service.ts
  fluency.service.spec.ts
  fluency-analysis.job.ts
  word-comparison.util.ts
  word-comparison.util.spec.ts
  index.ts

apps/web/components/admin/
  AdminDashboard.tsx
  TeachersPage.tsx
  StudentsPage.tsx

apps/web/components/fluency/
  FluencyAssessmentCard.tsx
```

## Dashboard aggregation queries

```typescript
// activeTeachers
await prisma.user.count({ where: { role: 'TEACHER', is_active: true, school_id: schoolId } })

// submissionsToday
const midnight = new Date(); midnight.setHours(0, 0, 0, 0);
await prisma.submission.count({ where: { created_at: { gte: midnight } } })

// submissionRate per class
await prisma.activityAssignment.groupBy({
  by: ['activity_id'],
  where: { activity: { class_id: { in: classIds } } },
  _count: { student_id: true },
})
```

## Clever SSO OAuth flow

```
GET /api/v1/auth/clever
  → redirect to https://clever.com/oauth/authorize
GET /api/v1/auth/clever/callback
  → exchange code for access_token
  → call Clever API /me → get user profile
  → upsert User (match by clever_id, then email)
  → generate JWT pair
  → set __rt cookie
  → redirect to dashboard
```

## Fluency scoring formula

```
WPM_normalized = min(WPM / grade_benchmark_WPM, 1.0)
FluencyScore = (accuracy * 0.4) + (WPM_normalized * 0.3) + (self_correction_proxy * 0.3)
```

Grade WPM benchmarks: PREK/K=30, G1=60, G2=90, G3=110, G4=130, G5=150

## Key dependencies

- `passport-oauth2` — Clever OAuth strategy
- `@aws-sdk/client-transcribe` — AWS Transcribe
- `nodemailer` — admin email notifications
- `csv-parse` — roster CSV parsing
