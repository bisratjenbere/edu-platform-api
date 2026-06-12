/**
 * Uploads Module Constants
 * Single source of truth for allowed MIME types, upload folders, and TTL values.
 */

export const ALLOWED_MIME_MAP: Record<
  string,
  { ext: string; maxBytes: number }
> = {
  'image/jpeg':      { ext: 'jpg',  maxBytes: 50  * 1024 * 1024 },
  'image/png':       { ext: 'png',  maxBytes: 50  * 1024 * 1024 },
  'image/gif':       { ext: 'gif',  maxBytes: 20  * 1024 * 1024 },
  'audio/webm':      { ext: 'webm', maxBytes: 100 * 1024 * 1024 },
  'audio/mp4':       { ext: 'm4a',  maxBytes: 100 * 1024 * 1024 },
  'video/webm':      { ext: 'webm', maxBytes: 500 * 1024 * 1024 },
  'video/mp4':       { ext: 'mp4',  maxBytes: 500 * 1024 * 1024 },
  'application/pdf': { ext: 'pdf',  maxBytes: 50  * 1024 * 1024 },
};

export const ALLOWED_FOLDERS = [
  'submissions',
  'avatars',
  'activities',
  'messages',
  'library',
  'fluency',
] as const;

export type AllowedFolder = (typeof ALLOWED_FOLDERS)[number];

// ---------------------------------------------------------------------------
// Gap 8 — TTL constants (previously magic numbers scattered in the service)
// ---------------------------------------------------------------------------

/** How long the presigned POST policy is valid (seconds). */
export const PRESIGNED_URL_TTL_SECONDS = 60;

/** How long the signed CloudFront URL is valid (days). */
export const SIGNED_CDN_URL_TTL_DAYS = 7;

// ---------------------------------------------------------------------------
// Required environment-variable keys — used by onModuleInit validation (Gap 12)
// ---------------------------------------------------------------------------
export const REQUIRED_CONFIG_KEYS = [
  'AWS_REGION',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'S3_BUCKET_NAME',
  'CLOUDFRONT_DOMAIN',
  'CLOUDFRONT_KEY_PAIR_ID',
  'CLOUDFRONT_PRIVATE_KEY',
] as const;

export type RequiredConfigKey = (typeof REQUIRED_CONFIG_KEYS)[number];