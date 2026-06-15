# Uploads Module — Design

## Architecture

```
POST /api/v1/uploads/presigned-url   → UploadsController → UploadsService.generatePresignedUrl()
POST /api/v1/uploads/confirm         → UploadsController → UploadsService.confirmUpload()

// Internal only — no HTTP route
UploadsService.deleteFile(key)       → called by other services on soft-delete
UploadsService.getSignedUrl(key)     → called by other services to refresh CDN URLs
```

---

## API contracts

### POST /api/v1/uploads/presigned-url

Request body:
```typescript
interface PresignedUrlRequestDto {
  fileName: string;    // original filename, used only for extension extraction
  fileType: string;    // MIME type declared by client
  folder: string;      // must be in ALLOWED_FOLDERS list
  fileSizeBytes: number; // declared size, used to set Content-Length-Range condition
}
```

Response:
```typescript
interface PresignedUrlResponseDto {
  uploadUrl: string;   // S3 presigned PUT URL, 60s expiry
  key: string;         // S3 object key — store this, send back on confirm
  cdnUrl: string;      // CloudFront URL (not yet live until confirm)
  expiresAt: string;   // ISO8601, 60s from now
}
```

### POST /api/v1/uploads/confirm

Request body:
```typescript
interface ConfirmUploadDto {
  key: string;         // S3 key returned from presigned-url step
}
```

Response:
```typescript
interface ConfirmUploadResponseDto {
  confirmed: boolean;
  signedUrl: string;   // CloudFront signed URL, 7-day expiry
  key: string;
}
```

---

## AWS SDK usage

```typescript
// Presigned PUT URL generation
import { S3Client, PutObjectCommand, HeadObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { getSignedUrl as getCloudfrontSignedUrl } from '@aws-sdk/cloudfront-signer';

// Presigned PUT — with Content-Length-Range condition to enforce max size
const command = new PutObjectCommand({
  Bucket: process.env.S3_BUCKET_NAME,
  Key: key,
  ContentType: fileType,
  // Content-Length-Range enforced via bucket policy + conditions map
});
const uploadUrl = await getSignedUrl(s3Client, command, { expiresIn: 60 });

// CloudFront signed URL — 7 days
const signedUrl = getCloudfrontSignedUrl({
  url: `https://${process.env.CLOUDFRONT_DOMAIN}/${key}`,
  keyPairId: process.env.CLOUDFRONT_KEY_PAIR_ID,
  privateKey: process.env.CLOUDFRONT_PRIVATE_KEY,
  dateLessThan: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
});

// HeadObject — verify upload exists on confirm
const head = await s3Client.send(new HeadObjectCommand({
  Bucket: process.env.S3_BUCKET_NAME,
  Key: key,
}));
```

---

## Key generation

```typescript
import { randomUUID } from 'crypto';
import { extname } from 'path';
import { lookup as mimeLookup } from 'mime-types';

function generateKey(folder: string, userId: string, fileName: string, fileType: string): string {
  // Derive extension from declared MIME type — never from client filename
  // This prevents extension spoofing (e.g. naming a .exe as .jpg)
  const ext = Object.entries(ALLOWED_MIME_MAP)
    .find(([mime]) => mime === fileType)?.[1].ext ?? 'bin';
  return `${folder}/${userId}/${randomUUID()}.${ext}`;
}
```

---

## Ownership verification on confirm

```typescript
// Key format: {folder}/{userId}/{uuid}.{ext}
// Extract userId segment and compare to req.user.id
function verifyKeyOwnership(key: string, userId: string): boolean {
  const segments = key.split('/');
  // segments[0] = folder, segments[1] = userId, segments[2] = filename
  return segments.length === 3 && segments[1] === userId;
}
```

---

## ALLOWED_MIME_MAP constant

```typescript
export const ALLOWED_MIME_MAP: Record<string, { ext: string; maxBytes: number }> = {
  'image/jpeg':       { ext: 'jpg',  maxBytes: 50  * 1024 * 1024 },
  'image/png':        { ext: 'png',  maxBytes: 50  * 1024 * 1024 },
  'image/gif':        { ext: 'gif',  maxBytes: 20  * 1024 * 1024 },
  'audio/webm':       { ext: 'webm', maxBytes: 100 * 1024 * 1024 },
  'audio/mp4':        { ext: 'm4a',  maxBytes: 100 * 1024 * 1024 },
  'video/webm':       { ext: 'webm', maxBytes: 500 * 1024 * 1024 },
  'video/mp4':        { ext: 'mp4',  maxBytes: 500 * 1024 * 1024 },
  'application/pdf':  { ext: 'pdf',  maxBytes: 50  * 1024 * 1024 },
};

export const ALLOWED_FOLDERS = [
  'submissions', 'avatars', 'activities', 'messages', 'library', 'fluency'
] as const;
```

---

## Environment variables required

```
AWS_REGION=
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
S3_BUCKET_NAME=
CLOUDFRONT_DOMAIN=
CLOUDFRONT_KEY_PAIR_ID=
CLOUDFRONT_PRIVATE_KEY=      # RSA private key for CloudFront signed URLs
```

---

## File structure

```
src/modules/uploads/
  dto/
    presigned-url.dto.ts
    confirm-upload.dto.ts
  uploads.module.ts
  uploads.controller.ts
  uploads.service.ts
  uploads.service.spec.ts
  uploads.constants.ts       — ALLOWED_MIME_MAP, ALLOWED_FOLDERS
  index.ts

apps/web/lib/
  mediaUpload.service.ts     — browser-side upload helper (see Task 3)
```

---

## Frontend upload helper contract

```typescript
// apps/web/lib/mediaUpload.service.ts
interface UploadOptions {
  file: File;
  folder: string;
  onProgress?: (percent: number) => void;
}

interface UploadResult {
  key: string;
  signedUrl: string;
}

// Usage in any component:
// const { key, signedUrl } = await uploadMedia({ file, folder: 'submissions', onProgress: setProgress });
```

Uses `XMLHttpRequest` (not fetch) to support `onProgress` events via `xhr.upload.addEventListener('progress', ...)`.

---

## Security notes

- Server NEVER receives file bytes — it only generates and validates URLs
- Key ownership is verifiable from the key itself (userId in segment[1])
- Presigned URL includes `ContentType` condition — S3 rejects uploads with wrong Content-Type
- `Content-Length-Range` condition in S3 bucket policy enforces max file size at infrastructure level
- CloudFront private key stored as multiline env var — never committed to repo