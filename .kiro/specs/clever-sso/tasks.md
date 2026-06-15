# Clever SSO Module — Tasks

## Prerequisites
- Auth module must be complete (JwtAuthGuard, RolesGuard, generateTokens() available)
- Admin module must be complete (School model with clever_enabled and clever_district_token)

## Implementation order (follow this sequence exactly)

- [ ] Task 1: Install dependencies
  - `passport-oauth2` + `@types/passport-oauth2`
  - `axios` (already in package.json — verify version ≥ 1.x)
  - Confirm `bullmq` and `ioredis` are already installed from earlier modules

- [ ] Task 2: CleverApiService
  - Wrap all Clever v3.0 API calls with Axios instance (baseURL: https://api.clever.com/v3.0)
  - Implement `withRetry()` helper — 429 exponential backoff (5s, 10s, 20s, max 3 retries)
  - `getProfile(accessToken)` → GET /me with Bearer token → return CleverProfile
  - `getTeachersForSchool(districtToken, cleverSchoolId)` → GET /schools/{id}/teachers
  - `getStudentsForSchool(districtToken, cleverSchoolId)` → GET /schools/{id}/students
  - `getSectionsForSchool(districtToken, cleverSchoolId)` → GET /schools/{id}/sections
  - All methods throw typed `CleverApiException` on non-retryable errors
  - Unit tests: successful call, 429 retry sequence, 5xx after retries throws

- [ ] Task 3: CleverStrategy (Passport)
  - Extend `PassportStrategy(Strategy, 'clever')` using `passport-oauth2`
  - Configure authorizationURL, tokenURL, clientID, clientSecret, callbackURL, scope, state
  - `validate(accessToken)` calls `CleverApiService.getProfile(accessToken)`
  - Returns CleverProfile for use in controller

- [ ] Task 4: CleverService — OAuth user upsert
  - `handleCallback(profile, cleverSchoolId)`:
    - Verify school.clever_enabled = true → throw ForbiddenException if not
    - Look up User by clever_id → then by email → then create new
    - Map Clever type ('teacher'/'student') to EduFlow Role enum
    - Set clever_id on user if not already set (account linking)
    - Update name/email if changed
    - Call AuthService.generateTokens(user) → return token pair
  - Unit tests: returning user by clever_id, first-time link by email, new user creation, school not enabled

- [ ] Task 5: CleverRosterSyncService
  - `enqueueSync(schoolId, triggeredBy)`:
    - Check Redis lock `clever_sync_running:{schoolId}` → throw ConflictException if set
    - Fetch school.clever_district_token and cleverSchoolId from DB
    - Enqueue BullMQ job with CleverSyncJobPayload
    - Return { jobId, status: 'QUEUED' }
  - `getSyncStatus(jobId)` → query BullMQ job state (waiting/active/completed/failed)
  - `getLastSyncSummary(schoolId)` → read Redis `clever_sync_last:{schoolId}`, return null if not set

- [ ] Task 6: CleverRosterSyncJob — BullMQ processor
  - Process `clever-roster-sync` queue
  - Implement full 8-step sync algorithm from design.md
  - Deactivation safety: only deactivate users if Clever API returned ≥ 1 teacher AND ≥ 1 student (guard against empty response treating everyone as removed)
  - On partial errors (some rows fail, others succeed): continue processing, accumulate errors[], set lastSyncStatus = 'PARTIAL'
  - On complete failure (API unreachable after retries): throw, let BullMQ retry (3x), then log to Sentry
  - Release Redis lock in `finally` block — always release even on exception
  - Unit tests: new users added, existing users updated, deactivation, partial error handling, lock release on failure, empty-response guard

- [ ] Task 7: Cron scheduling
  - At app bootstrap (main.ts), for each school with clever_enabled=true:
    - Calculate ms until next 2 AM in school.timezone using date-fns-tz
    - Enqueue a delayed BullMQ job for that school
  - After each successful sync job completes: re-enqueue next 24-hour delayed job
  - Use `date-fns-tz` for timezone-aware scheduling — never raw UTC offset arithmetic

- [ ] Task 8: CleverController
  - GET  /api/v1/auth/clever → @UseGuards(CleverAuthGuard) — initiates OAuth redirect
  - GET  /api/v1/auth/clever/callback → @UseGuards(CleverAuthGuard) → handleCallback → set __rt cookie → redirect to app
  - POST /api/v1/clever/sync → @Roles(SCHOOL_ADMIN, DISTRICT_ADMIN) → enqueueSync
  - GET  /api/v1/clever/sync/:jobId → @Roles(SCHOOL_ADMIN, DISTRICT_ADMIN) → getSyncStatus
  - GET  /api/v1/clever/sync/status → @Roles(SCHOOL_ADMIN, DISTRICT_ADMIN) → getLastSyncSummary
  - Full OpenAPI decorators on all methods

- [ ] Task 9: Frontend — Clever login button
  - Add "Log in with Clever" button to login page (shows only when school has Clever enabled OR on school-specific login URL)
  - Button links to GET /api/v1/auth/clever — standard redirect, no frontend OAuth handling
  - Handle callback redirect: if URL contains `?error=`, show error toast

- [ ] Task 10: Frontend — Admin sync panel
  - CleverSyncPanel component in Admin portal
  - Shows: last sync time, status badge (SUCCESS / PARTIAL / FAILED / NEVER), summary counts
  - "Sync now" button → calls POST /api/v1/clever/sync → polls status every 3s until complete
  - Progress indicator during sync