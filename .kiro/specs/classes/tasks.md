# Classes Module — Tasks

## Implementation order (follow this sequence exactly)

- [x] Task 1: Update database-schema.md + schema.prisma
  - Add `FamilyStudent` model with `FamilyStudentStatus` enum
  - Add `FamilyStudentStatus` enum
  - Add `ClassCode` model
  - Add `FamilyStudent[]` relation back-reference on `User` (two named relations: FamilyMember, StudentFamily)
  - Add `FamilyStudent[]` and `ClassCode[]` back-references on `Class`
  - Run `prisma migrate dev --name classes-family-classcode`
  - Update `.kiro/steering/database-schema.md` with the new models immediately

- [x] Task 2: DTOs — all 7 DTO files
  - `create-class.dto.ts` — name (required, max 100), subject (optional), grade_level (optional, IsEnum GradeLevel), school_year (required, matches pattern YYYY-YYYY), cover_color (optional, IsHexColor)
  - `update-class.dto.ts` — all fields from create, all optional (PartialType)
  - `add-co-teacher.dto.ts` — email (IsEmail)
  - `add-student.dto.ts` — student_id (IsUUID)
  - `import-roster.dto.ts` — file (Express.Multer.File, validated in controller)
  - `create-family-invite.dto.ts` — email (IsEmail), student_id (IsUUID)
  - `join-class.dto.ts` — code (IsString, Length(6,6), Matches /^[A-Z0-9]{6}$/))
  - All fields decorated with @ApiProperty / @ApiPropertyOptional

- [x] Task 3: ClassesService — core CRUD
  - `create(teacherId, schoolId, dto)` — create Class + ClassTeacher(PRIMARY), return ClassDetailDto
  - `findAll(teacherId, includeArchived)` — join ClassTeacher, compute counts via Prisma _count
  - `findOne(classId, requesterId)` — verify requester is ClassTeacher, return full detail
  - `update(classId, teacherId, dto)` — verify PRIMARY or CO_TEACHER, patch allowed fields
  - `archive(classId, teacherId)` — verify PRIMARY only, set is_archived = true
  - `softDelete(classId, teacherId)` — verify PRIMARY only, set deleted_at
  - All methods include `where: { deleted_at: null }` on every Prisma query

- [x] Task 4: Co-teacher management in ClassesService
  - `addCoTeacher(classId, requesterId, dto)` — verify requester is PRIMARY, find teacher by email in same school, create ClassTeacher(CO_TEACHER), send notification email
  - `removeCoTeacher(classId, requesterId, targetTeacherId)` — verify requester is PRIMARY, reject if target is PRIMARY, delete ClassTeacher record

- [x] Task 5: Student management in ClassesService
  - `addStudent(classId, teacherId, dto)` — verify teacher scope, upsert ClassStudent with default avatar
  - `removeStudent(classId, teacherId, studentId)` — verify teacher scope, set ClassStudent.is_active = false (never hard delete)

- [x] Task 6: RosterImportService
  - `import(classId, teacherId, schoolId, fileBuffer)` — parse CSV with `csv-parse`, validate each row, upsert User records, upsert ClassStudent records, return RosterImportResult
  - Synchronous path: ≤ 50 rows — process inline, return result immediately
  - Async path: > 50 rows — enqueue BullMQ job, return `{ jobId, status: 'PROCESSING' }`
  - `getImportStatus(jobId)` — poll job status from BullMQ queue
  - Full unit tests: valid CSV, rows with missing fields, duplicate emails, oversized file

- [ ]* Task 7: RosterImportJob — BullMQ processor
  - Process `roster-import` queue
  - For each row: find-or-create User, set school_id, upsert ClassStudent
  - On complete: emit `roster-import-complete` WebSocket event to teacher room
  - On failure after retries: log to Sentry, store error in Redis key `roster_import_error:{jobId}`

- [x] Task 8: FamilyInviteService
  - `invite(classId, teacherId, dto)` — verify teacher scope, verify student is in class, create FamilyStudent(PENDING), sign invite JWT, store token hash in Redis, send invite email via Nodemailer
  - `acceptInvite(token)` — verify JWT + Redis hash, set FamilyStudent.status = ACTIVE, clear Redis key, return access tokens
  - `revokeInvite(classId, teacherId, familyStudentId)` — verify teacher scope, set FamilyStudent.status = REVOKED, delete Redis key
  - Full unit tests: valid invite, expired token, already accepted, revoked token

- [x] Task 9: ClassCodeService
  - `generate(classId, teacherId)` — verify teacher scope, generate 6-char code via `crypto.randomBytes`, store in Redis with 48h TTL, upsert ClassCode record, return code
  - `join(studentId, dto)` — look up Redis key `class_code:{code}`, check `class_code_used:{code}:{studentId}` for replay, create ClassStudent, set used key with 72h TTL, return class detail
  - Full unit tests: valid join, expired code, replay attempt, already a member

- [x] Task 10: ClassesController — wire all endpoints
  - Apply `@UseGuards(JwtAuthGuard, RolesGuard)` on controller class
  - Apply correct `@Roles()` per endpoint:
    - create, list, get, update, archive, delete → TEACHER (+ SCHOOL_ADMIN for read)
    - addCoTeacher, removeCoTeacher → TEACHER
    - addStudent, removeStudent, importRoster → TEACHER
    - invite family, generate code → TEACHER
    - join → STUDENT
    - acceptInvite → FAMILY (public endpoint, JWT from invite link)
  - Add `@Throttle({ default: { limit: 10, ttl: 60000 } })` on import endpoint
  - Full OpenAPI decorators on every method

- [ ] Task 11: Unit tests
  - `classes.service.spec.ts` — create, findAll (scoped), archive, soft delete, permission checks
  - `roster-import.service.spec.ts` — valid rows, missing fields, async threshold
  - `family-invite.service.spec.ts` — invite, accept, expire, revoke
  - `class-code.service.spec.ts` — generate, join, replay, expire

- [ ] Task 12: Frontend — ClassesPage
  - Grid of ClassCard components (cover colour, grade, student count, pending badge)
  - CreateClassModal (form with colour picker)
  - ArchiveClass confirmation dialog
  - Skeleton loading states

- [ ] Task 13: Frontend — ClassDetailPage
  - Tabs: Students | Co-teachers | Family connections
  - StudentRoster table (avatar, name, status, remove action)
  - RosterImportButton (file picker, progress, result summary toast)
  - AddCoTeacherModal (email input)
  - FamilyInviteModal (email + student selector)
  - ClassCodeWidget (generate + display + copy + expiry countdown)