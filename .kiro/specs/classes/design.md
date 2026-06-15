# Classes Module — Design

## Architecture
POST   /api/v1/classes                                      → ClassesController → ClassesService.create()
GET    /api/v1/classes                                      → ClassesController → ClassesService.findAll()
GET    /api/v1/classes/:id                                  → ClassesController → ClassesService.findOne()
PATCH  /api/v1/classes/:id                                  → ClassesController → ClassesService.update()
POST   /api/v1/classes/:id/archive                          → ClassesController → ClassesService.archive()
DELETE /api/v1/classes/:id                                  → ClassesController → ClassesService.softDelete()
POST   /api/v1/classes/:id/teachers                         → ClassesController → ClassesService.addCoTeacher()
DELETE /api/v1/classes/:id/teachers/:teacherId              → ClassesController → ClassesService.removeCoTeacher()
POST   /api/v1/classes/:id/students                         → ClassesController → ClassesService.addStudent()
DELETE /api/v1/classes/:id/students/:studentId              → ClassesController → ClassesService.removeStudent()
POST   /api/v1/classes/:id/students/import                  → ClassesController → RosterImportService.import()
POST   /api/v1/classes/:id/family-invites                   → ClassesController → FamilyInviteService.invite()
GET    /api/v1/classes/family-invites/accept                → ClassesController → FamilyInviteService.accept()
DELETE /api/v1/classes/:id/family/:familyStudentId          → ClassesController → FamilyInviteService.revoke()
POST   /api/v1/classes/:id/class-code                       → ClassesController → ClassCodeService.generate()
POST   /api/v1/classes/join                                 → ClassesController → ClassCodeService.join()

---

## Data models

Uses existing models from database-schema.md: `Class`, `ClassTeacher`, `ClassStudent`.

### Model — FamilyStudent
Replaces the version in database-schema.md. This version includes `class_id`
because a family member can be connected to the same student across different
classes, and each connection has its own status and invite trail.

```prisma
enum FamilyStudentStatus {
  PENDING
  ACTIVE
  REVOKED
}

model FamilyStudent {
  id           String              @id @default(uuid())
  family_id    String
  student_id   String
  class_id     String
  status       FamilyStudentStatus @default(PENDING)
  invited_by   String
  invited_at   DateTime            @default(now())
  accepted_at  DateTime?
  created_at   DateTime            @default(now())
  updated_at   DateTime            @updatedAt
  deleted_at   DateTime?
  family       User                @relation("FamilyMember", fields: [family_id], references: [id])
  student      User                @relation("StudentFamily", fields: [student_id], references: [id])
  class        Class               @relation(fields: [class_id], references: [id])
  inviter      User                @relation("FamilyInviter", fields: [invited_by], references: [id])

  @@unique([family_id, student_id, class_id])
  @@index([student_id])
  @@index([family_id])
  @@index([class_id])
}
```

### Model — ClassCode
```prisma
model ClassCode {
  id         String   @id @default(uuid())
  class_id   String
  code       String   @unique
  created_by String
  expires_at DateTime
  created_at DateTime @default(now())
  class      Class    @relation(fields: [class_id], references: [id])

  @@index([class_id])
  @@index([code])
}
```

### Redis keys

| Key | Value | TTL | Set by | Purpose |
|-----|-------|-----|--------|---------|
| `class_code:{code}` | JSON `{ classId, createdBy }` | 48 hours | ClassCodeService.generate() | Validates join code on use |
| `class_code_used:{code}:{studentId}` | `"1"` | 72 hours | ClassCodeService.join() | Prevents student rejoining via same code |
| `family_invite:{tokenHash}` | `"1"` | 7 days | FamilyInviteService.invite() | Revocation check before accept — store hash not raw token |

Add all three keys to `redis-keys.md` under a new Classes module section.

---

## TypeScript interfaces

```typescript
// JWT payload for family invite links
interface FamilyInvitePayload {
  familyStudentId: string;
  email: string;
  classId: string;
  type: 'FAMILY_INVITE';
  iat: number;
  exp: number; // now + 7 days
}

// CSV import row shape (after parse)
interface RosterRow {
  firstName: string;
  lastName: string;
  email: string;
  gradeLevel?: GradeLevel;
}

// Import result — returned inline and emitted via WebSocket on async jobs
interface RosterImportResult {
  added: number;
  updated: number;
  failed: number;
  errors: Array<{ row: number; reason: string }>;
}

// Class detail response (includes computed counts)
interface ClassDetailDto {
  id: string;
  name: string;
  subject?: string;
  grade_level?: GradeLevel;
  school_year: string;
  cover_color: string;
  is_archived: boolean;
  teachers: Array<{ id: string; firstName: string; lastName: string; role: CoTeacherRole }>;
  student_count: number;
  pending_submission_count: number;
  created_at: Date;
}
```

---

## BullMQ queue: `roster-import`

Used only when CSV row count >= 50. Under 50 rows, import runs inline and
returns RosterImportResult synchronously.

```typescript
interface RosterImportJobPayload {
  classId: string;
  teacherId: string;
  schoolId: string;
  rows: RosterRow[];
  jobId: string; // correlates to a DB record for status polling
}
```

- Job name: `import-roster:{classId}`
- On complete: emit `roster-import-complete` via WebSocket to `user:{teacherId}`
  room with full RosterImportResult payload
- On failure: retry 2 times with exponential backoff, then emit
  `roster-import-failed` with `{ jobId, reason }` to teacher's room

---

## Family invite accept flow

1. Teacher calls `POST /classes/:id/family-invites` with family member's email
2. FamilyInviteService creates a `FamilyStudent` record with `status = PENDING`
3. A signed JWT (`FamilyInvitePayload`) is generated, expiry 7 days
4. Token hash stored in Redis: `family_invite:{tokenHash}` TTL 7 days
5. Invite email sent via Nodemailer with link:
   `{APP_URL}/api/v1/classes/family-invites/accept?token={rawToken}`
6. Family member clicks link → `GET /family-invites/accept?token=`
7. FamilyInviteService.accept():
   a. Verify JWT signature and expiry
   b. Hash the token, check Redis — if key missing, token was revoked → 401
   c. Load FamilyStudent by `familyStudentId` from payload
   d. If `status = REVOKED` or `deleted_at IS NOT NULL` → 401
   e. If `status = ACTIVE` → idempotent, return success (already accepted)
   f. Set `status = ACTIVE`, `accepted_at = now()`
   g. Delete Redis key (single-use after accept)
   h. Log AuditLog entry (action: `FAMILY_CONNECTED`)
   i. Redirect to family app login or return JWT session if already authenticated

---

## Student removal cascade

`ClassesService.removeStudent()` must:
1. Soft-delete the `ClassStudent` row (set `deleted_at`)
2. Find all `FamilyStudent` rows where `student_id = studentId`
   AND `class_id = classId` AND `deleted_at IS NULL`
3. For each: set `deleted_at = now()`, `status = REVOKED`
4. This removes family journal access for that student in that class
5. Log AuditLog entry (action: `STUDENT_REMOVED_FROM_CLASS`)

---

## File structure
src/modules/classes/
dto/
create-class.dto.ts
update-class.dto.ts
add-co-teacher.dto.ts
add-student.dto.ts
import-roster.dto.ts           — multipart file upload DTO
create-family-invite.dto.ts
join-class.dto.ts              — { code: string }
classes.module.ts
classes.controller.ts
classes.service.ts
classes.service.spec.ts
roster-import.service.ts
roster-import.service.spec.ts
roster-import.job.ts             — BullMQ processor
family-invite.service.ts
family-invite.service.spec.ts
class-code.service.ts
class-code.service.spec.ts
index.ts

---

## Key dependencies

- `csv-parse` — CSV parsing with header detection
- `@nestjs/bull` + `bullmq` — async roster import queue
- `nodemailer` — family invite and co-teacher notification emails
- `ioredis` — class code and invite token storage
- `@nestjs/jwt` — family invite link signing

---

## Security decisions

- Family invite tokens are signed JWTs so expiry is verifiable without Redis lookup
- Redis stores the token hash for revocation before expiry — raw token only
  travels in the email link, never stored server-side
- Class codes are 6-char uppercase alphanumeric, generated with `crypto.randomBytes`
- CSV uploads go through `file-type` magic-byte check before parsing —
  only `text/csv` accepted
- Teacher scope: all class mutations verify `req.user.id` is in `ClassTeacher`
  for that class with any role
- CO_TEACHER cannot remove the PRIMARY teacher or add/remove other co-teachers —
  only PRIMARY can perform those actions
- School admin can read all classes in their school but cannot mutate them
- `removeStudent()` must revoke all FamilyStudent rows for that student
  in that class — family access must not outlive student membership

---

## Tasks

- [ ] Task 1: DTOs — all 7 DTO files with full validation
- [ ] Task 2: ClassesService
  - create(), findAll(), findOne(), update(), archive(), softDelete()
  - addCoTeacher(), removeCoTeacher() — PRIMARY only for both
  - addStudent(), removeStudent() — removeStudent cascades to FamilyStudent revocation
- [ ] Task 3: ClassCodeService
  - generate() — crypto.randomBytes 6-char uppercase, store in DB + Redis
  - join() — validate code, check Redis used key, add student to class
- [ ] Task 4: FamilyInviteService
  - invite() — create FamilyStudent PENDING, sign JWT, hash token to Redis, send email
  - accept() — full 9-step flow defined above
  - revoke() — set FamilyStudent status = REVOKED, delete Redis key
- [ ] Task 5: RosterImportService
  - import() — magic-byte CSV check, parse with csv-parse, validate rows
  - < 50 rows: run inline, return RosterImportResult synchronously
  - >= 50 rows: enqueue BullMQ job, return { jobId, status: 'QUEUED' }
- [ ] Task 6: RosterImportJob — BullMQ processor
  - Upsert students (create if not exists, update name if changed)
  - Emit roster-import-complete with RosterImportResult to user:{teacherId} room
  - On failure after retries: emit roster-import-failed with { jobId, reason }
- [ ] Task 7: ClassesController — all endpoints, guards applied
- [ ] Task 8: Update database-schema.md
  - Replace FamilyStudent model with the version in this spec (includes class_id)
  - Add ClassCode model
- [ ] Task 9: Update redis-keys.md — add Classes module section with the three keys
- [ ] Task 10: Unit tests
  - classes.service.spec.ts
  - roster-import.service.spec.ts
  - family-invite.service.spec.ts
  - class-code.service.spec.ts