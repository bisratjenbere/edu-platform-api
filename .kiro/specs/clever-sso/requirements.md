# Clever SSO Module — Requirements

## Overview
Clever is a third-party identity provider used by thousands of US school districts.
Schools that use Clever manage their teacher and student rosters in Clever — EduFlow
must accept Clever OAuth logins and sync rosters nightly so the school never has to
manage users manually in EduFlow.

---

## User stories

### US-CLV-01 — Teacher logs in via Clever
As a teacher at a Clever-enabled school, I want to log in to EduFlow using my
Clever credentials so I don't need a separate EduFlow password.

**Acceptance criteria:**
- WHEN I click "Log in with Clever" on the login screen
- THEN I am redirected to Clever's OAuth authorisation page
- WHEN I authorise EduFlow in Clever
- THEN I am redirected back and receive a valid JWT access token + refresh token cookie
- WHEN my Clever email matches an existing EduFlow account
- THEN that account is linked (clever_id stored) and I am logged in
- WHEN my Clever email has no EduFlow account
- THEN a new account is created with role TEACHER, my name and email from Clever profile
- WHEN my school does not have clever_enabled = true
- THEN I receive 403 with message "Clever SSO is not enabled for your school"

### US-CLV-02 — Student logs in via Clever
As a student at a Clever-enabled school, I want to log in using my Clever
student credentials.

**Acceptance criteria:**
- WHEN I complete the Clever OAuth flow as a student
- THEN I receive a JWT session with role STUDENT
- WHEN my Clever student_number matches an existing EduFlow student account
- THEN the accounts are linked via clever_id
- WHEN no existing account is found
- THEN a new STUDENT account is created from the Clever profile

### US-CLV-03 — Nightly roster sync
As a school admin, I want EduFlow to automatically stay in sync with Clever
so I never have to manually import rosters.

**Acceptance criteria:**
- WHEN the nightly sync job runs at 2 AM in each school's local timezone
- THEN EduFlow fetches the latest sections, teachers, and students from Clever API
- AND new teachers and students are created in EduFlow with correct roles
- AND existing users have their name and email updated from Clever
- AND users no longer present in Clever are deactivated (is_active = false) in EduFlow
- AND the sync result is logged: { schoolId, added, updated, deactivated, errors[] }
- WHEN the Clever API returns 429 Too Many Requests
- THEN the job retries with exponential backoff (max 3 retries, starting at 5s)
- WHEN the Clever API returns 5xx
- THEN the job fails after retries and logs the error to Sentry without deactivating any users

### US-CLV-04 — Manual sync trigger
As a school admin, I want to trigger an immediate Clever sync without waiting
for the nightly job.

**Acceptance criteria:**
- WHEN I call POST /api/v1/clever/sync
- THEN a sync job is enqueued immediately (not inline — always async)
- AND I receive { jobId, status: 'QUEUED' }
- AND I can poll GET /api/v1/clever/sync/:jobId for status
- WHEN a sync is already running for my school
- THEN I receive 409 with message "A sync is already in progress for this school"

### US-CLV-05 — Clever sync status visibility
As a school admin, I want to see when the last sync ran and whether it succeeded.

**Acceptance criteria:**
- WHEN I call GET /api/v1/clever/sync/status
- THEN I receive: { lastSyncAt, lastSyncStatus: 'SUCCESS' | 'PARTIAL' | 'FAILED', summary: { added, updated, deactivated } }
- WHEN no sync has ever run
- THEN lastSyncAt is null and lastSyncStatus is null

---

## Clever API scope required

EduFlow requests these Clever OAuth scopes:
- `read:user_id` — unique Clever user identifier
- `read:sis` — SIS data: names, emails, student numbers
- `read:students` — student roster per section
- `read:teachers` — teacher roster per school
- `read:sections` — class/section data

---

## Out of scope for this module
- Clever Instant Login (QR-style — handled by Auth module QR flow)
- Clever Library (content sharing via Clever — not in roadmap)
- Two-way sync back to Clever (EduFlow is read-only consumer of Clever data)