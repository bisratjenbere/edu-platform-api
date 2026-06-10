---
inclusion: always
---

# EduFlow — Database Schema Reference

## Current Prisma schema

Update this file every time a new model is added. Kiro reads this to avoid
redefining existing models and to understand foreign key relationships.

```prisma
// ============================================================
// ENUMS
// ============================================================

// ============================================================
// ENUMS
// ============================================================

enum Role {
  SUPER_ADMIN
  DISTRICT_ADMIN
  SCHOOL_ADMIN
  TEACHER
  STUDENT
  FAMILY
}

enum GradeLevel {
  PREK
  K
  G1
  G2
  G3
  G4
  G5
}

enum ActivityStatus {
  DRAFT
  PUBLISHED
  ARCHIVED
}

enum BlockType {
  TEXT
  VOICE_INSTRUCTION
  VIDEO_INSTRUCTION
  IMAGE
  PDF
  LINK
  DRAWING_CANVAS
  MULTIPLE_CHOICE
  TRUE_FALSE
  POLL
  DRAG_DROP
  SHORT_ANSWER
  OPEN_ENDED
}

enum SubmissionStatus {
  NOT_STARTED
  IN_PROGRESS
  SUBMITTED
  RETURNED
  APPROVED
}

enum AssignedTo {
  WHOLE_CLASS
  INDIVIDUAL
}

enum ThreadType {
  DIRECT
  GROUP
  ANNOUNCEMENT
}

enum Platform {
  IOS
  ANDROID
  WEB
}

enum JournalPostType {
  ACTIVITY_SUBMISSION
  TEACHER_POST
  STUDENT_SELF_POST
}

enum JournalPostStatus {
  PENDING_APPROVAL
  APPROVED
  REJECTED
}

enum CoTeacherRole {
  PRIMARY
  CO_TEACHER
}

enum FluencyStatus {
  PENDING
  PROCESSING
  COMPLETE
  ERROR
}

enum FamilyStudentStatus {
  PENDING
  ACTIVE
  REVOKED
}

// NEW — replaces the raw String in NotificationPreference
enum NotificationType {
  NEW_ACTIVITY
  SUBMISSION_RECEIVED
  ACTIVITY_RETURNED
  JOURNAL_POST_APPROVED
  NEW_MESSAGE
  ACTIVITY_DUE_REMINDER
  FAMILY_CONNECTED
}

// ============================================================
// CORE MODELS
// ============================================================

model District {
  id         String    @id @default(uuid())
  name       String
  created_at DateTime  @default(now())
  updated_at DateTime  @updatedAt
  deleted_at DateTime?
  schools    School[]
}

model School {
  id                    String    @id @default(uuid())
  name                  String
  district_id           String
  timezone              String    @default("America/New_York")
  clever_enabled        Boolean   @default(false)
  clever_district_token String?
  created_at            DateTime  @default(now())
  updated_at            DateTime  @updatedAt
  deleted_at            DateTime?
  district              District  @relation(fields: [district_id], references: [id])
  users                 User[]
  classes               Class[]

  @@index([district_id])
}

model User {
  id                 String    @id @default(uuid())
  email              String    @unique
  password_hash      String?
  first_name         String    @default("")
  last_name          String    @default("")
  role               Role      @default(STUDENT)
  google_id          String?   @unique
  clever_id          String?   @unique
  school_id          String?
  is_active          Boolean   @default(true)
  last_login_at      DateTime?
  preferred_language String?   @default("en")
  created_at         DateTime  @default(now())
  updated_at         DateTime  @updatedAt
  deleted_at         DateTime?
  school             School?   @relation(fields: [school_id], references: [id])
  devices            UserDevice[]
  // NEW — family side of the family↔student link
  family_connections FamilyStudent[] @relation("FamilyMember")
  // NEW — student side of the family↔student link
  student_family_links FamilyStudent[] @relation("StudentFamily")
  // NEW — teacher who sent the family invite
  family_invites_sent FamilyStudent[] @relation("FamilyInviter")

  @@index([school_id])
  @@index([role, school_id])
  @@index([deleted_at])
}

// NEW — enforces which family member can see which student's content
// Each family connection is scoped to a specific class
model FamilyStudent {
  id          String              @id @default(uuid())
  family_id   String
  student_id  String
  class_id    String
  status      FamilyStudentStatus @default(PENDING)
  invited_by  String
  invited_at  DateTime            @default(now())
  accepted_at DateTime?
  created_at  DateTime            @default(now())
  updated_at  DateTime            @updatedAt
  deleted_at  DateTime?
  family      User                @relation("FamilyMember", fields: [family_id], references: [id])
  student     User                @relation("StudentFamily", fields: [student_id], references: [id])
  class       Class               @relation(fields: [class_id], references: [id])
  inviter     User                @relation("FamilyInviter", fields: [invited_by], references: [id])

  @@unique([family_id, student_id, class_id])
  @@index([student_id])
  @@index([family_id])
  @@index([class_id])
}

model Class {
  id           String      @id @default(uuid())
  name         String
  subject      String?
  grade_level  GradeLevel?
  school_year  String
  cover_color  String      @default("#4F46E5")
  school_id    String
  is_archived  Boolean     @default(false)
  created_at   DateTime    @default(now())
  updated_at   DateTime    @updatedAt
  deleted_at   DateTime?
  school       School      @relation(fields: [school_id], references: [id])
  teachers     ClassTeacher[]
  students     ClassStudent[]
  activities   Activity[]
  family_students FamilyStudent[]
  class_codes  ClassCode[]

  @@index([school_id])
  @@index([school_id, is_archived])
}

// NEW — Stores class join codes for student self-enrollment
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

// CHANGED — added deleted_at so roster removal is soft, not destructive
model ClassTeacher {
  class_id   String
  teacher_id String
  role       CoTeacherRole @default(PRIMARY)
  joined_at  DateTime      @default(now())
  deleted_at DateTime?                        // NEW
  class      Class         @relation(fields: [class_id], references: [id])
  teacher    User          @relation(fields: [teacher_id], references: [id])

  @@id([class_id, teacher_id])
  @@index([teacher_id])
}

// CHANGED — added deleted_at for the same reason
model ClassStudent {
  class_id      String
  student_id    String
  avatar_emoji  String    @default("🐶")
  joined_at     DateTime  @default(now())
  is_active     Boolean   @default(true)
  deleted_at    DateTime?                  // NEW
  class         Class     @relation(fields: [class_id], references: [id])
  student       User      @relation(fields: [student_id], references: [id])

  @@id([class_id, student_id])
  @@index([student_id])
  @@index([class_id, deleted_at])
}

model Activity {
  id                   String         @id @default(uuid())
  title                String
  description          String?
  class_id             String
  created_by           String
  status               ActivityStatus @default(DRAFT)
  due_date             DateTime?
  scheduled_publish_at DateTime?
  assigned_to          AssignedTo     @default(WHOLE_CLASS)
  is_from_library      Boolean        @default(false)
  library_source_id    String?
  standards_tags       String[]
  subject_tag          String?
  grade_level_tag      String?
  created_at           DateTime       @default(now())
  updated_at           DateTime       @updatedAt
  deleted_at           DateTime?
  class                Class          @relation(fields: [class_id], references: [id])
  creator              User           @relation(fields: [created_by], references: [id])
  blocks               ActivityBlock[]
  assignments          ActivityAssignment[]
  submissions          Submission[]

  @@index([class_id, status, deleted_at])
  @@index([created_by])
  @@index([scheduled_publish_at])            // scheduler job queries this
}

model ActivityBlock {
  id          String    @id @default(uuid())
  activity_id String
  order       Int
  type        BlockType
  content     Json
  is_required Boolean   @default(true)
  created_at  DateTime  @default(now())
  activity    Activity  @relation(fields: [activity_id], references: [id])

  @@unique([activity_id, order])
  @@index([activity_id])
}

// CHANGED — added deleted_at; hard-deleting this loses differentiation audit history
model ActivityAssignment {
  activity_id         String
  student_id          String
  custom_instructions String?
  assigned_at         DateTime  @default(now())
  deleted_at          DateTime?              // NEW
  activity            Activity  @relation(fields: [activity_id], references: [id])
  student             User      @relation(fields: [student_id], references: [id])

  @@id([activity_id, student_id])
  @@index([student_id, deleted_at])
}

model Submission {
  id                         String           @id @default(uuid())
  activity_id                String
  student_id                 String
  class_id                   String
  status                     SubmissionStatus @default(NOT_STARTED)
  started_at                 DateTime?
  submitted_at               DateTime?
  returned_at                DateTime?
  approved_at                DateTime?
  teacher_feedback_text      String?
  teacher_feedback_audio_url String?
  score                      Float?
  max_score                  Float?
  created_at                 DateTime         @default(now())
  updated_at                 DateTime         @updatedAt
  activity                   Activity         @relation(fields: [activity_id], references: [id])
  student                    User             @relation(fields: [student_id], references: [id])
  blocks                     SubmissionBlock[]
  journal_post               JournalPost?

  @@index([student_id, status])
  @@index([activity_id, status])             // teacher submission status view
  @@index([class_id, status])
}

model SubmissionBlock {
  id               String                   @id @default(uuid())
  submission_id    String
  block_id         String
  response_content Json                     // latest value — fast read
  auto_score       Float?
  annotation_json  String?
  created_at       DateTime                 @default(now())
  updated_at       DateTime                 @updatedAt  // NEW — track last edit time
  submission       Submission               @relation(fields: [submission_id], references: [id])
  // NEW — version history to satisfy US-SUB-07 "revision history preserved"
  revisions        SubmissionBlockRevision[]

  @@index([submission_id])
}

// NEW — stores each saved version of a block response
// response_content on SubmissionBlock is the latest; revisions are the history
model SubmissionBlockRevision {
  id                  String          @id @default(uuid())
  submission_block_id String
  response_content    Json
  revision_number     Int
  created_at          DateTime        @default(now())
  submission_block    SubmissionBlock @relation(fields: [submission_block_id], references: [id])

  @@index([submission_block_id, revision_number])
}

// CHANGED — added proper @relation directives (they were missing, breaking FK enforcement)
model JournalPost {
  id             String            @id @default(uuid())
  student_id     String
  class_id       String
  activity_id    String?
  submission_id  String?           @unique
  type           JournalPostType
  status         JournalPostStatus @default(PENDING_APPROVAL)
  content_text   String?
  media_urls     String[]
  approved_by    String?
  approved_at    DateTime?
  created_at     DateTime          @default(now())
  updated_at     DateTime          @updatedAt
  deleted_at     DateTime?
  submission     Submission?       @relation(fields: [submission_id], references: [id])
  student        User              @relation("StudentJournal", fields: [student_id], references: [id])   // NEW
  class          Class             @relation(fields: [class_id], references: [id])                       // NEW
  approver       User?             @relation("JournalApprover", fields: [approved_by], references: [id]) // NEW
  reactions      JournalReaction[]
  comments       JournalComment[]

  @@index([student_id, status, deleted_at])    // family feed query
  @@index([class_id, status])                  // teacher pending approval view
  @@index([student_id, created_at])            // chronological feed
}

model JournalReaction {
  id         String      @id @default(uuid())
  post_id    String
  user_id    String
  type       String      @default("HEART")
  created_at DateTime    @default(now())
  post       JournalPost @relation(fields: [post_id], references: [id])

  @@unique([post_id, user_id])
  @@index([post_id])
}

model JournalComment {
  id          String      @id @default(uuid())
  post_id     String
  author_id   String
  author_role String
  content     String
  created_at  DateTime    @default(now())
  updated_at  DateTime    @updatedAt
  deleted_at  DateTime?
  post        JournalPost @relation(fields: [post_id], references: [id])

  @@index([post_id, deleted_at])
}

model MessageThread {
  id            String              @id @default(uuid())
  class_id      String
  thread_type   ThreadType
  created_by    String
  subject       String?
  allow_replies Boolean             @default(true)
  created_at    DateTime            @default(now())
  updated_at    DateTime            @updatedAt
  participants  ThreadParticipant[]
  messages      Message[]

  @@index([class_id])
}

// CHANGED — added deleted_at so removing a family member from a class
// doesn't permanently or indefinitely expose them to threads
model ThreadParticipant {
  thread_id    String
  user_id      String
  last_read_at DateTime?
  deleted_at   DateTime?             // NEW
  thread       MessageThread @relation(fields: [thread_id], references: [id])

  @@id([thread_id, user_id])
  @@index([user_id, deleted_at])     // unread count query
}

model Message {
  id                String        @id @default(uuid())
  thread_id         String
  sender_id         String
  body              String
  attachments       Json          @default("[]")
  translated_bodies Json          @default("{}")
  created_at        DateTime      @default(now())
  updated_at        DateTime      @updatedAt
  deleted_at        DateTime?
  thread            MessageThread @relation(fields: [thread_id], references: [id])

  @@index([thread_id, created_at])   // message feed pagination
  @@index([sender_id])
}

model UserDevice {
  id           String   @id @default(uuid())
  user_id      String
  token        String   @unique
  platform     Platform
  created_at   DateTime @default(now())
  last_seen_at DateTime @default(now())
  user         User     @relation(fields: [user_id], references: [id])

  @@index([user_id])
}

// CHANGED — notification_type is now the enum, not a raw String
model NotificationPreference {
  id                String           @id @default(uuid())
  user_id           String
  notification_type NotificationType // was: String
  enabled           Boolean          @default(true)

  @@unique([user_id, notification_type])
  @@index([user_id])
}

model AuditLog {
  id            String   @id @default(uuid())
  actor_id      String
  action        String
  resource_type String
  resource_id   String?
  metadata      Json     @default("{}")
  ip_address    String?
  created_at    DateTime @default(now())

  @@index([actor_id])
  @@index([resource_type, resource_id])
  @@index([created_at])                  // retention/archival queries
}

// CHANGED — added deleted_at, updated_at, proper @relation to User,
// and removed direct avg_rating mutation (use TemplateRating aggregation instead)
model ActivityTemplate {
  id             String      @id @default(uuid())
  title          String
  description    String?
  subject        String?
  grade_level    GradeLevel?
  standards_tags String[]
  created_by     String
  is_published   Boolean     @default(false)
  view_count     Int         @default(0)
  copy_count     Int         @default(0)
  // avg_rating and rating_count are now computed from TemplateRating,
  // not mutated directly — avoids the race condition
  thumbnail_url  String?
  blocks_snapshot Json
  created_at     DateTime    @default(now())
  updated_at     DateTime    @updatedAt   // NEW
  deleted_at     DateTime?               // NEW
  creator        User        @relation(fields: [created_by], references: [id])  // NEW
  ratings        TemplateRating[]                                                // NEW

  @@index([is_published, deleted_at])
  @@index([created_by])
  @@index([grade_level, subject])        // library filter queries
}

// NEW — replaces direct avg_rating mutation; prevents duplicate ratings per user
// avg_rating on ActivityTemplate should be a computed field or updated via this table
model TemplateRating {
  id          String           @id @default(uuid())
  template_id String
  user_id     String
  score       Int              // 1–5
  review      String?
  created_at  DateTime         @default(now())
  updated_at  DateTime         @updatedAt
  template    ActivityTemplate @relation(fields: [template_id], references: [id])
  rater       User             @relation(fields: [user_id], references: [id])

  @@unique([template_id, user_id])       // one rating per user per template
  @@index([template_id])
}

// CHANGED — added grade_level (required by the WPM benchmark scoring formula)
// Without this the fluency score calculation has no grade to benchmark against
model FluencyAssessment {
  id            String        @id @default(uuid())
  student_id    String
  teacher_id    String
  class_id      String
  grade_level   GradeLevel?                // NEW — populated at creation from the class
  passage_text  String
  recording_url String?
  transcript    String?
  analysis      Json?
  status        FluencyStatus @default(PENDING)
  created_at    DateTime      @default(now())
  updated_at    DateTime      @updatedAt
  student       User          @relation("FluencyStudent", fields: [student_id], references: [id])  // NEW
  teacher       User          @relation("FluencyTeacher", fields: [teacher_id], references: [id])  // NEW

  @@index([class_id, status])
  @@index([student_id, created_at])      // progress-over-time query
}

model AiUsageLog {
  id                String   @id @default(uuid())
  teacher_id        String
  feature           String
  prompt_tokens     Int
  completion_tokens Int
  created_at        DateTime @default(now())

  @@index([teacher_id, created_at])      // daily rate-limit check query
}