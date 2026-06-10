---
inclusion: fileMatch
fileMatchPattern: ["**/*.service.ts", "**/auth/**", "**/messages/**", "**/clever/**", "**/notifications/**"]
---

# EduFlow — Redis Key Conventions

## Rules that apply to every key

- All keys use colon-separated namespacing: `{namespace}:{identifier}`
- All keys must have an explicit TTL — no key is ever set without expiry
- Key names are defined here only — never invent a new key format in a service
  without adding it to this document first
- Never store raw PII (email, name, student data) as a key or value
- All values are either a short string ("1", "true") or JSON — never raw objects

---

## Key directory

### Auth module

| Key | Value | TTL | Set by | Purpose |
|-----|-------|-----|--------|---------|
| `refresh:{userId}` | plain refresh token string | 7 days | AuthService.login() / refreshToken() | Validates refresh token, enables rotation |
| `used_qr:{token}` | `"1"` | 60 seconds | QrService.validateQr() | Single-use enforcement — TTL must equal token lifetime exactly |
| `login_attempts:{ip}` | attempt count string | 15 minutes | AuthService.login() | Rate limiting — max 5 before 429 |

**Refresh token rotation rule:**
On every `/auth/refresh` call, delete the old key before setting the new one.
If the delete succeeds but the set fails, the user must re-login — do not retry silently.

---

### Messaging module

| Key | Value | TTL | Set by | Purpose |
|-----|-------|-----|--------|---------|
| `unread:{userId}` | integer string e.g. `"3"` | No expiry — deleted on read | MessagesService.sendMessage() | Unread message counter per user |

**Increment:** `INCR unread:{userId}` on every new message sent to that user.
**Reset:** `DEL unread:{userId}` when the user calls PATCH /messages/threads/:id/read.
**Read:** `GET unread:{userId}` — treat a missing key as 0, never as an error.

---

### Clever SSO module

| Key | Value | TTL | Set by | Purpose |
|-----|-------|-----|--------|---------|
| `clever_sync_running:{schoolId}` | `"1"` | 30 minutes | CleverRosterSyncJob | Prevents duplicate concurrent syncs |
| `clever_sync_last:{schoolId}` | JSON CleverSyncResult | No expiry | CleverRosterSyncJob | Latest sync summary for status endpoint |

**CleverSyncResult JSON shape:**
```json
{
  "schoolId": "string",
  "added": 0,
  "updated": 0,
  "deactivated": 0,
  "errors": [{ "cleverId": "string", "reason": "string" }],
  "completedAt": "ISO8601",
  "status": "SUCCESS | PARTIAL | FAILED"
}
```

`PARTIAL` means the sync completed but errors[] is non-empty.
`FAILED` means the sync aborted before deactivation ran.

---

### Notifications module

| Key | Value | TTL | Set by | Purpose |
|-----|-------|-----|--------|---------|
| `notif_job:{activityId}` | BullMQ job id string | Duration until due_date + 25h | NotificationsService.scheduleReminder() | Tracks the due-reminder job id so it can be cancelled if due_date changes |

**Cancellation rule:** When a due_date is updated or removed on an activity,
look up `notif_job:{activityId}`, cancel the BullMQ job by that id,
then delete the Redis key. If the key is missing, treat as a no-op.

---

### Classes module

| Key | Value | TTL | Set by | Purpose |
|-----|-------|-----|--------|---------|
| `class_code:{code}` | classId string | 48 hours | ClassCodeService.generate() | Maps a 6-char join code to a class id |
| `class_code_used:{code}:{studentId}` | `"1"` | 72 hours | ClassCodeService.join() | Replay prevention — TTL longer than code to cover edge cases |
| `roster_import_error:{jobId}` | JSON error string | 24 hours | RosterImportJob (on failure) | Stores import failure detail for polling |
| `family_invite:{tokenHash}` | familyStudentId string | 7 days | FamilyInviteService.invite() | Validates family invite token, cleared on accept or revoke |

**Class code join rule:**
Before creating ClassStudent, check `class_code_used:{code}:{studentId}`.
If it exists — return 409 (already joined via this code).
Set the used key AFTER successfully creating ClassStudent, not before.

**Family invite rule:**
Hash the invite JWT with SHA-256 before storing as the Redis key suffix.
On acceptInvite: verify JWT, hash it, look up the Redis key, compare familyStudentId.
Delete the Redis key immediately after successful acceptance — single use.

---

### AI module

| Key | Value | TTL | Set by | Purpose |
|-----|-------|-----|--------|---------|
| `ai_daily:{teacherId}:{date}` | integer string e.g. `"7"` | 24 hours from first use that day | AiService.generateActivity() | Daily generation count — date is UTC YYYY-MM-DD |

**Rate limit check:** `GET ai_daily:{teacherId}:{date}` before every generation.
If value >= 20, return 429 with message "Daily generation limit reached".
**Increment:** `INCR` then `EXPIRE` to 24h on first use of the day.
Use UTC date consistently — never local/school timezone for this key.

---

## Operational rules for all modules

- Use `ioredis` as the Redis client — never the `redis` package
- Inject Redis via a shared `RedisModule` — never instantiate a new client per service
- All Redis operations must be wrapped in try/catch —
  a Redis failure must never crash a request; degrade gracefully
- Log Redis errors at warn level, not error — Redis outages are recoverable
- Never use Redis transactions (MULTI/EXEC) unless the operation is
  explicitly documented here as requiring atomicity