/**
 * Uploads Module Constants
 * Single source of truth for allowed MIME types and upload folders
 */

export const ALLOWED_MIME_MAP: Record<
  string,
  { ext: string; maxBytes: number }
> = {
  'image/jpeg': { ext: 'jpg', maxBytes: 50 * 1024 * 1024 },
  'image/png': { ext: 'png', maxBytes: 50 * 1024 * 1024 },
  'image/gif': { ext: 'gif', maxBytes: 20 * 1024 * 1024 },
  'audio/webm': { ext: 'webm', maxBytes: 100 * 1024 * 1024 },
  'audio/mp4': { ext: 'm4a', maxBytes: 100 * 1024 * 1024 },
  'video/webm': { ext: 'webm', maxBytes: 500 * 1024 * 1024 },
  'video/mp4': { ext: 'mp4', maxBytes: 500 * 1024 * 1024 },
  'application/pdf': { ext: 'pdf', maxBytes: 50 * 1024 * 1024 },
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
