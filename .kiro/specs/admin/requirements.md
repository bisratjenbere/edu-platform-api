# Admin Portal Module — Full Spec

## Requirements
School and district admins manage teacher accounts, rosters, and view
engagement analytics across their school.

## API endpoints
```
GET    /api/v1/admin/dashboard                  — aggregate stats
GET    /api/v1/admin/teachers                   — paginated teacher list
POST   /api/v1/admin/teachers                   — create teacher + send welcome email
PATCH  /api/v1/admin/teachers/:id/deactivate
POST   /api/v1/admin/teachers/:id/reset-password
GET    /api/v1/admin/classes                    — all classes with teacher + student count
GET    /api/v1/admin/students                   — all students, searchable
POST   /api/v1/admin/rosters/bulk-import        — CSV school-wide import
GET    /api/v1/admin/reports/engagement         — weekly submission rates per class
POST   /api/v1/admin/export/student/:studentId  — export portfolio as JSON
```

## Dashboard stats (Prisma aggregations)
- activeTeachers: count users where role=TEACHER, is_active=true, school_id=X
- submissionsToday: count submissions where created_at >= today midnight
- submissionRate per class: (SUBMITTED+APPROVED count / total assignments) * 100

## Tasks
- [ ] Task 1: AdminService — all stats, teacher CRUD, bulk import
- [ ] Task 2: AdminController — all endpoints, SCHOOL_ADMIN + DISTRICT_ADMIN guards
- [ ] Task 3: BulkImportService — CSV parse, upsert students, return summary
- [ ] Task 4: Frontend — AdminDashboard (stat cards, EngagementChart with Recharts)
- [ ] Task 5: Frontend — TeachersPage (TanStack Table, deactivate/reset actions)
- [ ] Task 6: Frontend — StudentsPage (searchable table, CSV export button)
- [ ] Task 7: Unit tests

---

# Clever SSO Module — Full Spec

## Requirements
Schools using Clever log in via OAuth and have rosters synced automatically nightly.

## OAuth flow
```
GET /api/v1/auth/clever           → redirect to Clever OAuth
GET /api/v1/auth/clever/callback  → exchange code, upsert user, return JWT pair
```

## Nightly sync (BullMQ cron: 2 AM school local time)
1. Find schools with clever_enabled = true
2. For each: fetch sections, teachers, students from Clever API
3. Upsert all (create if not exist, update name/email)
4. Deactivate users no longer in Clever response
5. Log sync result

## Tasks
- [ ] Task 1: CleverApiService — getMe, getStudents, getTeachers, getSections (axios, 429 retry)
- [ ] Task 2: CleverStrategy (Passport) — OAuth callback, upsert user
- [ ] Task 3: CleverRosterSyncJob — full cron job implementation
- [ ] Task 4: CleverController — OAuth endpoints
- [ ] Task 5: Unit tests — sync (added, updated, deactivated), API error handling

---

# Reading Fluency Assessment Module — Full Spec

## Requirements
Teachers create assessments with a reading passage. Students record themselves
reading aloud. AWS Transcribe converts audio to text. The system scores fluency.

## API endpoints
```
POST /api/v1/fluency/assessments                  — create with passage_text
POST /api/v1/fluency/assessments/:id/recording    — student uploads recording URL
GET  /api/v1/fluency/assessments/:id              — get with analysis
GET  /api/v1/fluency/class/:classId               — all assessments in class
```

## Analysis pipeline (BullMQ job: fluency-analysis)
1. Download audio from S3
2. Start AWS Transcribe job
3. Poll every 5s until complete (max 2 min)
4. Compare transcript to passage word-by-word:
   - WPM = words / recording_duration_minutes
   - Accuracy = correct words / total words * 100
   - Mispronounced: Levenshtein distance < 3 from passage word
   - Omitted: passage words missing from transcript
   - Added: transcript words not in passage
   - FluencyScore = 40% accuracy + 30% WPM-normalized + 30% proxy
5. Save analysis, status = COMPLETE
6. Emit `fluency-complete` via WebSocket

## Tasks
- [ ] Task 1: FluencyService — create, saveRecording, getAssessment, getByClass
- [ ] Task 2: FluencyAnalysisJob — full AWS Transcribe + word comparison implementation
- [ ] Task 3: WordComparisonUtil — Levenshtein-based word diff algorithm
- [ ] Task 4: FluencyController — all endpoints
- [ ] Task 5: Frontend — FluencyAssessmentCard (side-by-side passage/transcript, metrics)
- [ ] Task 6: Unit tests — WordComparisonUtil (mispronounced, omitted, added detection)

---

# Uploads Module — Full Spec

## Requirements
Browser uploads files directly to S3 using presigned PUT URLs.
Server never handles raw file bytes.

## API endpoints
```
POST /api/v1/uploads/presigned-url  — { fileName, fileType, folder } → { uploadUrl, fileUrl, key }
POST /api/v1/uploads/confirm        — { key } → { confirmed, url }
```

## Security
- Validate fileType against allowlist via `file-type` npm package (magic bytes)
- Allowed: image/jpeg, image/png, image/gif, audio/webm, audio/mp4, video/webm, application/pdf
- Max size enforced at presigned URL level (Content-Length-Range condition)
- S3 key format: `{folder}/{userId}/{uuid}.{ext}` — never user-controlled
- Presigned URL expiry: 60 seconds
- Returned URL: CloudFront CDN domain (not S3 direct)

## Tasks
- [ ] Task 1: UploadsService — generatePresignedUrl, confirmUpload, deleteFile
- [ ] Task 2: UploadsController — both endpoints, auth required
- [ ] Task 3: Frontend — mediaUpload.service.ts (browser → S3 direct, progress events)
- [ ] Task 4: Unit tests
