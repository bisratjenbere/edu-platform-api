# Auth Module — Requirements

## Overview
Authentication and access control for all user roles. Supports email/password,
Google OAuth2, QR code login for young students, and Clever SSO.

## User stories

### US-AUTH-01 — Teacher registration
As a teacher, I want to register with my email and password so I can access the platform.

**Acceptance criteria:**
- WHEN I submit a valid email, password (min 8 chars), and name
- THEN my account is created with role TEACHER and is_active = true
- AND I receive a JWT access token (15 min) and refresh token (7 days) as HttpOnly cookie
- AND a duplicate email returns 409 Conflict with message "Email already in use"

### US-AUTH-02 — Teacher/family login
As a teacher or family member, I want to log in with email and password.

**Acceptance criteria:**
- WHEN I submit correct credentials
- THEN I receive a JWT access token and refresh token cookie
- AND my last_login_at is updated
- WHEN I submit wrong password 5 times in 15 minutes
- THEN my IP is rate-limited and returns 429 Too Many Requests

### US-AUTH-03 — Google OAuth login
As a teacher, I want to log in with my Google account.

**Acceptance criteria:**
- WHEN I click "Continue with Google" and authorise
- THEN if my Google email matches an existing account, I am logged in
- AND if no account exists, one is created with role TEACHER
- AND my google_id is stored to link future Google logins

### US-AUTH-04 — QR code login for K–2 students
As a young student who cannot type, I want to scan a QR code to log in.

**Acceptance criteria:**
- WHEN a teacher requests a QR code for a student
- THEN a QR image is returned encoding a signed token (60 second expiry)
- WHEN the student scans the QR
- THEN they are logged in as that student with a valid session
- AND the QR token is invalidated immediately (single-use)
- AND a replayed QR token returns 401 Unauthorized

### US-AUTH-05 — Token refresh
As any logged-in user, I want my session to stay active without re-entering credentials.

**Acceptance criteria:**
- WHEN my access token expires and I send my refresh token cookie
- THEN I receive a new access token and a new refresh token
- AND the old refresh token is invalidated in Redis
- WHEN the refresh token is expired or invalid
- THEN I receive 401 and must log in again

### US-AUTH-06 — Logout
As any user, I want to log out and invalidate my session.

**Acceptance criteria:**
- WHEN I call POST /auth/logout
- THEN my refresh token is deleted from Redis
- AND the __rt cookie is cleared
- AND my access token remains valid until its 15-minute expiry (stateless)

### US-AUTH-07 — Role-based access
As the system, I must enforce that users can only access resources permitted for their role.

**Acceptance criteria:**
- WHEN a STUDENT tries to access a teacher-only endpoint
- THEN they receive 403 Forbidden
- WHEN a TEACHER tries to access a SCHOOL_ADMIN endpoint
- THEN they receive 403 Forbidden

## Out of scope for this module
- Two-factor authentication (Phase 2)
- Clever SSO (separate spec: clever-sso)
- Password reset flow (included but separate endpoint)
