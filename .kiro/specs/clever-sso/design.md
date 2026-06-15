# Clever SSO Module — Design

## Architecture

```
GET  /api/v1/auth/clever              → CleverController → CleverStrategy (redirect to Clever OAuth)
GET  /api/v1/auth/clever/callback     → CleverController → CleverService.handleCallback()
POST /api/v1/clever/sync              → CleverController → CleverRosterSyncService.enqueueSync()
GET  /api/v1/clever/sync/:jobId       → CleverController → CleverRosterSyncService.getSyncStatus()
GET  /api/v1/clever/sync/status       → CleverController → CleverRosterSyncService.getLastSyncSummary()
```

---

## OAuth flow detail

```
Browser                   EduFlow API              Clever OAuth
   |                          |                         |
   |-- GET /auth/clever ----→ |                         |
   |                          |-- redirect (302) ------→|
   |                          |                         |-- user authorises
   |                          |←--- callback + code ----|
   |                          |-- exchange code --------→|
   |                          |←--- access_token --------|
   |                          |-- GET /v3.0/me ----------→|
   |                          |←--- profile --------------|
   |                          |-- upsert User             |
   |←--- JWT + __rt cookie ---|                           |
```

---

## Passport strategy

```typescript
// clever.strategy.ts
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-oauth2';

@Injectable()
export class CleverStrategy extends PassportStrategy(Strategy, 'clever') {
  constructor(private cleverService: CleverService) {
    super({
      authorizationURL: 'https://clever.com/oauth/authorize',
      tokenURL: 'https://clever.com/oauth/tokens',
      clientID: process.env.CLEVER_CLIENT_ID,
      clientSecret: process.env.CLEVER_CLIENT_SECRET,
      callbackURL: `${process.env.APP_URL}/api/v1/auth/clever/callback`,
      scope: ['read:user_id', 'read:sis', 'read:students', 'read:teachers', 'read:sections'],
      state: true, // CSRF protection
    });
  }

  async validate(accessToken: string): Promise<CleverProfile> {
    return this.cleverService.getProfile(accessToken);
  }
}
```

---

## CleverApiService

Wraps all Clever API v3.0 HTTP calls with Axios. Handles 429 retry automatically.

```typescript
// Clever API base URL
const CLEVER_API = 'https://api.clever.com/v3.0';

interface CleverProfile {
  id: string;          // Clever user ID → stored as clever_id
  email: string;
  name: { first: string; last: string };
  type: 'teacher' | 'student' | 'district_admin';
  school?: string;     // Clever school ID
  student_number?: string;
}

interface CleverSection {
  id: string;
  name: string;
  grade: string;
  subject: string;
  teacher: string;     // Clever teacher ID
  students: string[];  // Clever student IDs
}

// Methods:
// getProfile(accessToken): CleverProfile
// getTeachersForSchool(schoolToken, cleverschoolId): CleverProfile[]
// getStudentsForSchool(schoolToken, cleverSchoolId): CleverProfile[]
// getSectionsForSchool(schoolToken, cleverSchoolId): CleverSection[]
```

**429 retry logic:**
```typescript
async function withRetry<T>(fn: () => Promise<T>, maxRetries = 3, baseDelay = 5000): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (err.response?.status === 429 && attempt < maxRetries) {
        const delay = baseDelay * Math.pow(2, attempt); // 5s, 10s, 20s
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
}
```

---

## CleverService — user upsert logic

```typescript
async handleCallback(profile: CleverProfile): Promise<{ user: User; isNew: boolean }> {
  // 1. Look up by clever_id first (returning user)
  // 2. Fall back to email lookup (first Clever login on existing account)
  // 3. If nothing found, create new user
  // 4. In all cases: update clever_id, name if changed
  // 5. Verify school has clever_enabled = true — throw ForbiddenException if not
  // 6. Map Clever type → EduFlow Role: teacher→TEACHER, student→STUDENT
}
```

---

## BullMQ queue: `clever-roster-sync`

```typescript
interface CleverSyncJobPayload {
  schoolId: string;             // EduFlow school ID
  cleverSchoolToken: string;    // school.clever_district_token
  cleverSchoolId: string;       // Clever's own school ID
  triggeredBy: 'CRON' | 'MANUAL';
  triggeredAt: string;          // ISO8601
}

interface CleverSyncResult {
  schoolId: string;
  added: number;
  updated: number;
  deactivated: number;
  errors: Array<{ cleverId: string; reason: string }>;
  completedAt: string;
}
```

Cron schedule: `0 2 * * *` in each school's timezone (use `school.timezone` field).
Because schools span timezones, a separate delayed job is enqueued per school at
server startup and after each successful sync, calculated as ms until next 2 AM local.

Redis keys:
- `clever_sync_running:{schoolId}` → `"1"` — TTL: 30 minutes (lock to prevent duplicate jobs)
- `clever_sync_last:{schoolId}` → JSON CleverSyncResult — no TTL (latest result, always kept)

---

## Sync algorithm (CleverRosterSyncJob processor)

Set Redis lock: clever_sync_running:{schoolId} (TTL: 30 min)
Fetch ALL pages from Clever API before processing anything:
a. Fetch all teachers for school (paginate until no next_page cursor)
b. Fetch all students for school (paginate until no next_page cursor)
c. Fetch all sections for school (paginate until no next_page cursor)
d. If ANY fetch or pagination step fails (network error, 5xx, timeout):

Log error to Sentry
Clear Redis lock
Throw — do NOT proceed to steps 3–5
Do NOT deactivate any users on a partial fetch
e. Only proceed to step 3 when ALL pages for ALL resource types
are successfully fetched and held in memory


For each teacher in the complete fetched set:
a. findUnique by clever_id OR email
b. If not found: create User(role=TEACHER, school_id, clever_id, name, email)
c. If found: update name, email if changed; set is_active=true
For each student in the complete fetched set:
a. findUnique by clever_id OR email OR student_number
b. If not found: create User(role=STUDENT, school_id, clever_id, name, email)
c. If found: update fields if changed; set is_active=true
Deactivation — only runs after steps 3 and 4 complete without error:
a. Build a Set of all clever_ids present in the fetched response
b. Find all EduFlow users for school where clever_id IS NOT NULL
AND clever_id NOT IN that Set
c. Set is_active=false for each (do NOT hard delete, do NOT touch deleted_at)
d. Users with no clever_id (manually created) are never deactivated by sync
Store CleverSyncResult in Redis clever_sync_last:{schoolId}
Clear Redis lock
Log AuditLog entry (action: CLEVER_SYNC_COMPLETE)


### Sync failure modes and expected behaviour

| Failure point | Behaviour |
|---|---|
| Any Clever API page fetch fails | Abort entire sync, no deactivations, log to Sentry |
| Clever returns 429 | Retry with exponential backoff (5s, 10s, 20s), max 3 retries |
| Clever returns 5xx | Same as page fetch failure above |
| DB upsert fails for one user | Log error, skip that user, continue sync, record in errors[] |
| Deactivation step fails | Log error, leave users active, record in errors[] |
| Lock already held on job start | Return 409, do not enqueue duplicate |
---

## File structure

```
src/modules/clever/
  clever.module.ts
  clever.controller.ts
  clever.strategy.ts
  clever-api.service.ts          — Axios wrapper for Clever v3.0 API
  clever.service.ts              — OAuth callback, user upsert
  clever.service.spec.ts
  clever-roster-sync.service.ts  — enqueue, status, last result
  clever-roster-sync.job.ts      — BullMQ processor
  clever-roster-sync.job.spec.ts
  index.ts
```

---

## Environment variables required

```
CLEVER_CLIENT_ID=
CLEVER_CLIENT_SECRET=
APP_URL=                          # used to construct OAuth callback URL
```

---

## Security notes

- `state` param enabled on OAuth strategy to prevent CSRF on callback
- `clever_district_token` stored encrypted at rest (AES-256, handled at DB infrastructure level)
- Sync deactivates but never deletes — preserves submission/journal history for deactivated students
- Manual sync endpoint restricted to SCHOOL_ADMIN and DISTRICT_ADMIN roles only
- CleverSyncJob errors are sent to Sentry but never deactivate users unless the full response is confirmed valid — partial API failures do not trigger deactivation