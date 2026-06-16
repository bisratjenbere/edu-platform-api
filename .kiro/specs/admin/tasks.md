# Admin Module — Tasks

## Implementation order (follow this sequence exactly)

- [x] Task 1: DTOs
  - `create-teacher.dto.ts` — email (IsEmail), firstName (IsString, max 100), lastName (IsString, max 100), schoolId (IsUUID)
  - `reset-password.dto.ts` — no body required (server generates temp password)
  - `bulk-import.dto.ts` — file validated in controller (Express.Multer.File, CSV only)

- [x] Task 2: AdminService
  - `getDashboard(schoolId)` — return: activeTeachers count, submissionsToday count, submissionRatePerClass array, all via Prisma aggregations
  - `getTeachers(schoolId, page, limit)` — offset-paginated, include class count per teacher
  - `createTeacher(schoolId, dto)` — create User with role = TEACHER, send welcome email via Nodemailer, log AuditLog entry
  - `deactivateTeacher(teacherId, adminId)` — set is_active = false, log AuditLog, enqueue email notification
  - `resetPassword(teacherId, adminId)` — generate temp password, hash it, update user, send email, log AuditLog
  - `getClasses(schoolId, page, limit)` — offset-paginated with teacher names and student counts
  - `getStudents(schoolId, search?, page?, limit?)` — searchable by name/email, offset-paginated
  - `exportStudentPortfolio(studentId, adminId)` — verify student is in admin's school, return JSON of all journal posts + submission metadata

- [x] Task 3: BulkImportService
  - `import(schoolId, adminId, fileBuffer)` — parse CSV, validate headers (email, firstName, lastName, role), upsert User rows, assign school_id, return { added, updated, errors[] }
  - Expected CSV columns: `email, first_name, last_name, role` (role must be TEACHER or STUDENT)
  - Max 1000 rows per import
  - Log AuditLog entry for bulk import action

- [x] Task 4: AdminController — all endpoints
  - `@Roles(Role.SCHOOL_ADMIN)` on all school-scoped endpoints
  - `@Roles(Role.DISTRICT_ADMIN, Role.SUPER_ADMIN)` on cross-school endpoints
  - Full OpenAPI decorators

- [ ] Task 5: Frontend — AdminDashboard
  - Stat cards: Active Teachers, Submissions Today, Avg Submission Rate
  - EngagementChart: weekly submission rate per class (Recharts LineChart)
  - Quick links to TeachersPage and StudentsPage

- [ ] Task 6: Frontend — TeachersPage
  - TanStack Table with columns: name, email, class count, last login, status
  - Deactivate action (confirmation dialog)
  - Reset password action
  - Create teacher button → CreateTeacherModal

- [x] Task 7: Unit tests
  - `admin.service.spec.ts` — getDashboard (correct aggregations), createTeacher (email sent + audit log), deactivateTeacher (is_active = false + audit log), bulkImport (valid rows, invalid role, duplicate email)

---

# Clever SSO Module — Tasks

- [ ] Task 1: CleverApiService — `src/modules/clever/clever-api.service.ts`
  - `getMe(accessToken)` — GET https://api.clever.com/v3.0/me
  - `getStudents(schoolId, accessToken)` — paginated, handle 429 with exponential backoff
  - `getTeachers(schoolId, accessToken)` — paginated, handle 429
  - `getSections(schoolId, accessToken)` — paginated, handle 429

- [ ] Task 2: CleverStrategy — Passport OAuth2 strategy
  - Scope: `read:user_id read:students read:teachers read:sections`
  - Callback: exchange code for tokens, call getMe, upsert User with clever_id, return user
  - If user email matches existing account → link clever_id

- [ ] Task 3: CleverRosterSyncJob — BullMQ cron, runs at 02:00 school local time
  - For each school where clever_enabled = true:
    - Check Redis `clever_sync_running:{schoolId}` — skip if locked
    - Set lock with 30m TTL
    - Fetch sections, teachers, students from Clever API
    - Upsert all users (create if not exist, update name/email)
    - Deactivate users not in Clever response (set is_active = false)
    - Write CleverSyncResult JSON to Redis `clever_sync_last:{schoolId}`
    - Delete lock key on completion or failure

- [ ] Task 4: CleverController
  - `GET /api/v1/auth/clever` — redirect to Clever OAuth (no auth guard)
  - `GET /api/v1/auth/clever/callback` — exchange code, set `__rt` cookie, return JWT
  - `GET /api/v1/admin/clever/sync-status` — `@Roles(SCHOOL_ADMIN)`, return Redis `clever_sync_last:{schoolId}`

- [ ] Task 5: Unit tests
  - `clever-roster-sync.spec.ts` — sync (added, updated, deactivated), API 429 retry, duplicate lock prevention

---

# Fluency Module — Tasks

- [ ] Task 1: DTOs
  - `create-assessment.dto.ts` — student_id (IsUUID), class_id (IsUUID), passage_text (IsString, IsNotEmpty, max 5000)
  - `save-recording.dto.ts` — recording_url (IsString, IsUrl — must be CloudFront URL)

- [ ] Task 2: FluencyService
  - `create(teacherId, dto)` — verify teacher owns class, look up student's grade_level from ClassStudent, create FluencyAssessment with status = PENDING, populate grade_level
  - `saveRecording(assessmentId, studentId, dto)` — verify student owns assessment, update recording_url, enqueue FluencyAnalysisJob
  - `getAssessment(assessmentId, requesterId)` — verify teacher or student access
  - `getByClass(classId, teacherId)` — verify teacher owns class, return all assessments with latest analysis

- [ ] Task 3: FluencyAnalysisJob — BullMQ queue: `fluency-analysis`
  - Download audio from S3 using recording_url
  - Start AWS Transcribe job (unique job name: `fluency-{assessmentId}`)
  - Poll every 5s until COMPLETED or FAILED (max 24 polls = 2 minutes)
  - On completion: run WordComparisonUtil.compare(transcript, passage_text)
  - Compute FluencyScore = 40% accuracy + 30% WPM-normalized + 30% self-correction proxy
  - Update FluencyAssessment: transcript, analysis (JSON), status = COMPLETE
  - Emit `fluency-complete` WebSocket event to teacher room

- [ ] Task 4: WordComparisonUtil — `src/modules/fluency/word-comparison.util.ts`
  - `compare(transcript, passage)` — returns: { wpm, accuracy, mispronounced[], omitted[], added[], fluencyScore }
  - Levenshtein distance < 3 = mispronounced (not counted as omitted)
  - Normalised WPM benchmark per grade level (from GradeLevel enum)

- [ ] Task 5: FluencyController — all endpoints
  - `POST /api/v1/fluency/assessments` — `@Roles(Role.TEACHER)`
  - `POST /api/v1/fluency/assessments/:id/recording` — `@Roles(Role.STUDENT)`
  - `GET /api/v1/fluency/assessments/:id` — `@Roles(Role.TEACHER, Role.STUDENT)`
  - `GET /api/v1/fluency/class/:classId` — `@Roles(Role.TEACHER)`
  - Full OpenAPI decorators

- [ ] Task 6: Frontend — FluencyAssessmentCard
  - Side-by-side: passage text (left) vs transcript (right)
  - Colour-coded word diff: green = correct, orange = mispronounced, red = omitted, blue = added
  - Metrics row: WPM, Accuracy %, Fluency Score
  - Status badge: Pending | Processing | Complete | Error

- [ ] Task 7: Unit tests
  - `word-comparison.util.spec.ts` — perfect read, mispronounced (Levenshtein), omitted words, added words, mixed passage
  - `fluency.service.spec.ts` — create (grade_level populated), saveRecording (job enqueued)
