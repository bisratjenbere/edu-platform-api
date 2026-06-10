# Uploads Module — Requirements

## Overview
Uploads is a Phase 1 shared infrastructure module. It provides secure, direct
browser-to-S3 file uploads via presigned PUT URLs. The API server never handles
raw file bytes — it only generates presigned URLs and confirms uploads after
completion. Every other module (Submissions, Messaging, Activities, Library,
Fluency) depends on this module for all media handling.

---

## User stories

### US-UPL-01 — Get a presigned upload URL
As any authenticated user, I want to get a presigned S3 URL so my browser can
upload a file directly without routing bytes through the server.

**Acceptance criteria:**
- WHEN I submit a valid fileName, fileType (MIME), and folder
- THEN I receive a presigned PUT URL (60-second expiry) and the final CDN URL
- WHEN the fileType is not in the allowed MIME list
- THEN I receive 400 with message "File type not permitted"
- WHEN the requested file size exceeds 50 MB (via Content-Length-Range condition on presigned URL)
- THEN S3 rejects the upload directly — the server enforces this at URL generation time
- WHEN I am not authenticated
- THEN I receive 401

### US-UPL-02 — Confirm a completed upload
As any authenticated user, I want to confirm that my file was successfully
uploaded so the application can reference it.

**Acceptance criteria:**
- WHEN I call the confirm endpoint with the S3 key
- THEN the server calls S3 HeadObject to verify the file exists
- AND returns the final signed CloudFront URL (7-day expiry)
- WHEN the key does not exist in S3
- THEN I receive 404 with message "Upload not found — file may not have reached S3"
- WHEN the key does not belong to the requesting user
- THEN I receive 403 Forbidden (key format enforces ownership: `{folder}/{userId}/{uuid}.{ext}`)

### US-UPL-03 — Delete a file
As the system (called internally by other services), I want to delete a file
from S3 when the parent record is soft-deleted.

**Acceptance criteria:**
- WHEN UploadsService.deleteFile(key) is called internally
- THEN the S3 object is deleted
- WHEN the key does not exist, the operation is a no-op (S3 delete is idempotent)
- This endpoint is NOT exposed via HTTP — internal service call only

### US-UPL-04 — Allowed file types enforcement
As the system, I must validate file type using magic bytes, not the
Content-Type header, to prevent MIME spoofing attacks.

**Acceptance criteria:**
- WHEN a presigned URL is requested with fileType: "image/jpeg"
- THEN the server validates the extension matches the declared MIME type
- AND sets the presigned URL's Content-Type condition to match
- WHEN a presigned URL is requested with fileType: "application/octet-stream" or any unlisted type
- THEN the request is rejected with 400
- Note: magic-byte validation happens client-side before requesting the URL
  AND server-side in the confirm step via S3 metadata check

---

## Allowed MIME types

| MIME type        | Extensions | Max size | Used by             |
|------------------|------------|----------|---------------------|
| image/jpeg       | .jpg .jpeg | 50 MB    | Submissions, Messaging, Library |
| image/png        | .png       | 50 MB    | Submissions, Messaging, Library |
| image/gif        | .gif       | 20 MB    | Submissions          |
| audio/webm       | .webm      | 100 MB   | Submissions (audio), Fluency |
| audio/mp4        | .m4a       | 100 MB   | Submissions (audio)  |
| video/webm       | .webm      | 500 MB   | Submissions (video)  |
| video/mp4        | .mp4       | 500 MB   | Submissions (video)  |
| application/pdf  | .pdf       | 50 MB    | Activities, Messaging |

---

## S3 key naming convention

```
{folder}/{userId}/{uuid}.{ext}
```

Examples:
- `submissions/usr_abc123/f47ac10b.webm`
- `avatars/usr_abc123/3e4a1b9c.png`
- `activities/usr_abc123/8d2f91aa.pdf`

Folder values are controlled by the server — the client declares intended folder
but the server validates it against an allowlist:
`['submissions', 'avatars', 'activities', 'messages', 'library', 'fluency']`

---

## Out of scope for this module
- Image resizing / transcoding (handled by downstream processing pipeline, future phase)
- Virus scanning (infrastructure concern, handled at S3 event level)
- Multi-part uploads for files > 500 MB (not needed for current limits)