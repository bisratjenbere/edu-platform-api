---
inclusion: fileMatch
fileMatchPattern: ["**/*.service.ts", "**/*.controller.ts", "**/auth/**", "**/prisma/**"]
---

# EduFlow — Security Policies

## Authentication rules

- bcrypt salt rounds: always 12 — never lower
- JWT access token: 15-minute expiry, signed with JWT_SECRET
- JWT refresh token: 7-day expiry, signed with JWT_REFRESH_SECRET
- Refresh tokens stored in Redis key: `refresh:{userId}` (plain token string, TTL 7 days)
- Refresh token returned in JSON body by AuthService — AuthController sets it as HttpOnly,
  Secure, SameSite=Strict cookie named `__rt` before sending the response to the client
- Every /auth/refresh call MUST delete the old Redis key before writing the new one
- Rate limit /auth/login: max 5 attempts per 15 minutes per IP

## Authorization rules

- Every controller endpoint must have @UseGuards(JwtAuthGuard, RolesGuard)
- Every controller endpoint must have @Roles(...) decorator
- Teachers can only access their own classes — always filter by teacher_id
- Students can only access their own submissions and journal
- Family members can only access content for their connected child
- School admins are scoped to their school_id — never return cross-school data
- District admins are scoped to their district_id

## Data access rules

- NEVER return soft-deleted records (deleted_at IS NOT NULL)
- NEVER expose password_hash in any API response — always exclude it
- NEVER expose other students' data to a student or family member
- NEVER return raw S3 URLs — always return signed CloudFront URLs
- Student PII must never appear in logs — mask email and names in log output
- Teacher-to-student messages must be queryable by SCHOOL_ADMIN (safeguarding)

## Input sanitization — apply to every DTO

```typescript
// Every string field in a DTO must have these decorators
@IsString()
@Transform(({ value }) => sanitizeHtml(value, { allowedTags: [] })) // strip all HTML
@MaxLength(10000) // set appropriate limit per field
fieldName: string;
```

## File upload security

- Validate MIME type using magic bytes via `file-type` npm package — never trust Content-Type header
- S3 presigned PUT URLs: 60-second expiry
- CloudFront signed URLs: 7-day expiry
- S3 key format: `{folder}/{userId}/{uuid}.{ext}` — never user-controlled key names
- Allowed folder values (server-validated): submissions, avatars, activities, messages, library, fluency

### Allowed MIME types and size limits (single source of truth — do not duplicate this table)

| MIME type       | Extensions   | Max size | Used by                          |
|-----------------|--------------|----------|----------------------------------|
| image/jpeg      | .jpg .jpeg   | 50 MB    | Submissions, Messaging, Library  |
| image/png       | .png         | 50 MB    | Submissions, Messaging, Library  |
| image/gif       | .gif         | 20 MB    | Submissions                      |
| audio/webm      | .webm        | 100 MB   | Submissions (audio), Fluency     |
| audio/mp4       | .m4a         | 100 MB   | Submissions (audio)              |
| video/webm      | .webm        | 500 MB   | Submissions (video)              |
| video/mp4       | .mp4         | 500 MB   | Submissions (video)              |
| application/pdf | .pdf         | 50 MB    | Activities, Messaging            |

The uploads spec references this table — do not maintain a separate list there.
Any module that handles file uploads must validate against this table only.

## Audit logging — required for these actions

Always call AuditLogService.log() for:
- User account created / deactivated / deleted
- Role changed
- Data export requested
- Admin login
- Bulk roster import
- Class deleted

```typescript
await this.auditLogService.log({
  actorId: req.user.id,
  action: 'USER_DEACTIVATED',
  resourceType: 'User',
  resourceId: targetUserId,
  metadata: { reason },
  ipAddress: req.ip,
});
```

## Compliance reminders

- COPPA: never collect unnecessary data from students under 13
- FERPA: student educational records only accessible to authorized school personnel and family
- GDPR: support data deletion requests — soft delete + scheduled hard delete after 30 days
- All DB data encrypted at rest (AES-256) — handled at infrastructure level
- All transit encrypted (TLS 1.2+) — enforced via HTTPS-only infrastructure
