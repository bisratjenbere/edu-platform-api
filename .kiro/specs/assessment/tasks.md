# Assessment Module — Tasks

## Implementation order (follow this sequence exactly)

- [ ] Task 1: DTOs
  - `teacher-feedback.dto.ts` — status (IsEnum: RETURNED | APPROVED only), teacher_feedback_text (IsString, optional, max 5000), teacher_feedback_audio_url (IsString, IsUrl, optional)
  - `save-annotation.dto.ts` — block_id (IsUUID), annotation_json (IsString, IsNotEmpty, max 100000)

- [ ] Task 2: AssessmentService
  - `getAllSubmissions(activityId, teacherId)` — verify teacher owns activity's class, return all submissions with student info and block scores
  - `updateFeedback(submissionId, teacherId, dto)` — verify teacher owns class, update status + feedback fields, enqueue push notification if RETURNED, call JournalService.createPostFromSubmission if APPROVED
  - `saveAnnotation(submissionId, blockId, teacherId, dto)` — verify teacher owns class, upsert annotation_json on SubmissionBlock
  - `getAnnotation(submissionId, blockId, teacherId)` — verify teacher owns class, return annotation_json
  - `getClassAnalytics(classId, teacherId)` — verify teacher owns class, return submissionRate, averageScore, scoreDistribution via Prisma aggregations
  - `getStudentProgress(studentId, teacherId)` — verify teacher has student in a class, return weekly submission counts + per-standards-tag mastery

- [ ] Task 3: AssessmentController — all endpoints
  - `@Roles(Role.TEACHER)` on all endpoints
  - `@Roles(Role.TEACHER, Role.SCHOOL_ADMIN)` on getAllSubmissions (school admin safeguarding view)
  - Full OpenAPI decorators on every method

- [ ] Task 4: Frontend — SubmissionReviewPanel
  - Split layout: 40% student response / 60% feedback panel
  - Left panel: renders each block type read-only (reuses SubmissionBlockRenderer)
  - DrawingCanvas with `readOnly={true}` and annotation overlay mode
  - Prev/next student navigation arrows (keyboard ← → supported)
  - Submission status badge in header

- [ ] Task 5: Frontend — FeedbackPanel
  - Text feedback textarea (auto-resize)
  - Voice feedback recorder (uses AudioRecorder in compact mode)
  - Annotation toggle button (activates DrawingCanvas annotation mode)
  - Return button (requires feedback or annotation)
  - Approve button (one click)
  - Auto-grade score display (per block + total)

- [ ] Task 6: Frontend — ClassAnalyticsDashboard
  - Submission rate progress ring (Recharts RadialBarChart)
  - Score distribution bar chart (Recharts BarChart)
  - Per-student score table (sortable by score DESC)
  - Date range filter (last 7 / 30 / 90 days)

- [ ] Task 7: Unit tests
  - `assessment.service.spec.ts` — getAllSubmissions (teacher scoped), updateFeedback (RETURNED triggers notification, APPROVED triggers journal post), getClassAnalytics (correct aggregations), access control violations
