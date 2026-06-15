# Uploads Module — Tasks

## Implementation order (follow this sequence exactly)

- [x] Task 1: uploads.constants.ts
  - Define `ALLOWED_MIME_MAP` with all 8 MIME types, extensions, and maxBytes
  - Define `ALLOWED_FOLDERS` readonly tuple
  - Export both — every other task imports from here, never redefines inline

- [x] Task 2: DTOs
  - `presigned-url.dto.ts`
    - fileName: IsString, IsNotEmpty, MaxLength(255)
    - fileType: IsString, IsIn(Object.keys(ALLOWED_MIME_MAP))
    - folder: IsString, IsIn(ALLOWED_FOLDERS)
    - fileSizeBytes: IsInt, Min(1), Max(500 * 1024 * 1024)
  - `confirm-upload.dto.ts`
    - key: IsString, IsNotEmpty, Matches(/^[a-z]+\/[a-z0-9-]+\/[a-f0-9-]+\.[a-z0-9]+$/)

- [x] Task 3: UploadsService
  - `generatePresignedUrl(userId, dto)`:
    - Validate folder in ALLOWED_FOLDERS (throw BadRequestException if not)
    - Validate fileType in ALLOWED_MIME_MAP (throw BadRequestException if not)
    - Validate fileSizeBytes ≤ ALLOWED_MIME_MAP[fileType].maxBytes
    - Generate key via generateKey() helper
    - Call AWS SDK PutObjectCommand + getSignedUrl with 60s expiry
    - Return { uploadUrl, key, cdnUrl (unsigned, just the CF domain + key), expiresAt }
  - `confirmUpload(userId, dto)`:
    - Verify key ownership via verifyKeyOwnership() — throw ForbiddenException if mismatch
    - Call S3 HeadObjectCommand — throw NotFoundException if 404
    - Generate CloudFront signed URL with 7-day expiry
    - Return { confirmed: true, signedUrl, key }
  - `deleteFile(key)`:
    - Call S3 DeleteObjectCommand — no error if key doesn't exist (idempotent)
    - Internal method — no auth check needed (caller is responsible)
  - `getSignedUrl(key)`:
    - Generate fresh CloudFront signed URL for an existing key
    - Used by other services when serving stored media
    - Internal method

- [x] Task 4: UploadsController
  - POST /api/v1/uploads/presigned-url → @Roles(TEACHER, STUDENT, FAMILY)
  - POST /api/v1/uploads/confirm → @Roles(TEACHER, STUDENT, FAMILY)
  - Both endpoints: @UseGuards(JwtAuthGuard, RolesGuard)
  - @Throttle({ default: { limit: 30, ttl: 60000 } }) on presigned-url (30 uploads/min max)
  - Full OpenAPI decorators on both methods

- [ ] Task 5: Frontend — mediaUpload.service.ts (must be done after API is live)
  - `uploadMedia({ file, folder, onProgress })` function
  - Step 1: POST /api/v1/uploads/presigned-url with file metadata
  - Step 2: PUT directly to S3 uploadUrl using XMLHttpRequest for progress events
  - Step 3: POST /api/v1/uploads/confirm with key
  - Return { key, signedUrl }
  - Handle S3 PUT errors (network fail, size rejected) and surface as typed errors
  - Export `UploadError` class with `type: 'SIZE_EXCEEDED' | 'TYPE_REJECTED' | 'NETWORK_ERROR'`

- [x] Task 6: Unit tests — uploads.service.spec.ts
  - generatePresignedUrl: valid request, invalid MIME type, invalid folder, oversized file
  - confirmUpload: valid key, key not found in S3, key ownership mismatch
  - deleteFile: existing key, non-existent key (no-op)
  - getSignedUrl: returns valid CloudFront URL
  - Mock all AWS SDK calls with jest.fn() — never hit real S3 in unit tests