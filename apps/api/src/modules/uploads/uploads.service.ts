import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  Logger,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  HeadObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { getSignedUrl as getCloudfrontSignedUrl } from '@aws-sdk/cloudfront-signer';
import { randomUUID } from 'crypto';
import { PresignedUrlDto, ConfirmUploadDto } from './dto';
import {
  ALLOWED_MIME_MAP,
  ALLOWED_FOLDERS,
  PRESIGNED_URL_TTL_SECONDS,
  SIGNED_CDN_URL_TTL_DAYS,
  REQUIRED_CONFIG_KEYS,
} from './uploads.constants';

// ---------------------------------------------------------------------------
// Gap 4 — typed JWT payload so we never cast to `any` in the controller
// ---------------------------------------------------------------------------
export interface JwtPayload {
  /** Subject — the authenticated user's ID. */
  sub: string;
  iat?: number;
  exp?: number;
}

@Injectable()
export class UploadsService implements OnModuleInit {
  // Gap 5 — structured logger instead of console.warn
  private readonly logger = new Logger(UploadsService.name);

  private s3Client: S3Client;
  private bucketName: string;
  private cloudfrontDomain: string;
  private cloudfrontKeyPairId: string;
  private cloudfrontPrivateKey: string;

  constructor(private readonly configService: ConfigService) {
    // Gap 6 — maxAttempts: 3 for built-in exponential-backoff retry on transient errors
    this.s3Client = new S3Client({
      region: this.configService.get<string>('AWS_REGION'),
      credentials: {
        accessKeyId:
          this.configService.get<string>('AWS_ACCESS_KEY_ID') ?? '',
        secretAccessKey:
          this.configService.get<string>('AWS_SECRET_ACCESS_KEY') ?? '',
      },
      maxAttempts: 3,
    });

    this.bucketName =
      this.configService.get<string>('S3_BUCKET_NAME') ?? '';
    this.cloudfrontDomain =
      this.configService.get<string>('CLOUDFRONT_DOMAIN') ?? '';
    this.cloudfrontKeyPairId =
      this.configService.get<string>('CLOUDFRONT_KEY_PAIR_ID') ?? '';
    this.cloudfrontPrivateKey =
      this.configService.get<string>('CLOUDFRONT_PRIVATE_KEY') ?? '';
  }

  // -------------------------------------------------------------------------
  // Gap 12 — fail fast at startup if any required env var is absent
  // -------------------------------------------------------------------------
  onModuleInit(): void {
    for (const key of REQUIRED_CONFIG_KEYS) {
      if (!this.configService.get<string>(key)) {
        throw new Error(
          `UploadsService: missing required configuration key "${key}". ` +
            'Set it in your environment or .env file before starting the server.',
        );
      }
    }
    this.logger.log('Configuration validated — all required keys present');
  }

  // -------------------------------------------------------------------------
  // Gap 1 + Gap 2 — presigned POST replaces presigned PUT.
  //   The S3 policy now enforces:
  //     • Content-Type must equal dto.fileType (Gap 1)
  //     • actual upload byte-count must be within [1, mimeConfig.maxBytes] (Gap 2)
  //   Both conditions are evaluated by S3 at upload time, not by the API.
  //
  // Gap 10 — cdnUrl removed from this response; it was unsigned and misleading.
  //           The authoritative signed URL is returned only after /confirm.
  // -------------------------------------------------------------------------
  async generatePresignedUrl(
    userId: string,
    dto: PresignedUrlDto,
  ): Promise<{
    success: true;
    data: {
      /** Multipart POST endpoint — submit fields + file as multipart/form-data. */
      uploadUrl: string;
      /** Hidden fields that MUST be included verbatim in the multipart POST body. */
      fields: Record<string, string>;
      key: string;
      expiresAt: string;
    };
    error: null;
  }> {
    // Validate folder (belt-and-suspenders alongside DTO @IsIn)
    if (!ALLOWED_FOLDERS.includes(dto.folder as AllowedFolderUnion)) {
      throw new BadRequestException('Invalid folder');
    }

    // Validate file type
    const mimeConfig = ALLOWED_MIME_MAP[dto.fileType];
    if (!mimeConfig) {
      throw new BadRequestException('File type not permitted');
    }

    // Validate client-declared size against MIME limit (fast client-side gate;
    // the real enforcement is the content-length-range policy condition below)
    if (dto.fileSizeBytes > mimeConfig.maxBytes) {
      throw new BadRequestException(
        `File size exceeds maximum for ${dto.fileType} (${mimeConfig.maxBytes / (1024 * 1024)} MB)`,
      );
    }

    const key = this.generateKey(dto.folder, userId, dto.fileType);

    // Gap 1 + Gap 2 — presigned POST with policy conditions
    const { url: uploadUrl, fields } = await createPresignedPost(
      this.s3Client,
      {
        Bucket: this.bucketName,
        Key: key,
        Conditions: [
          // S3 will reject any PUT whose Content-Type header differs from this
          { 'Content-Type': dto.fileType },
          // S3 will reject uploads outside [1 byte, mimeConfig.maxBytes]
          ['content-length-range', 1, mimeConfig.maxBytes],
        ],
        Fields: {
          'Content-Type': dto.fileType,
        },
        Expires: PRESIGNED_URL_TTL_SECONDS,
      },
    );

    const expiresAt = new Date(
      Date.now() + PRESIGNED_URL_TTL_SECONDS * 1000,
    ).toISOString();

    this.logger.log(
      `Presigned POST generated: key=${key} userId=${userId} mimeType=${dto.fileType}`,
    );

    return {
      success: true,
      data: { uploadUrl, fields, key, expiresAt },
      error: null,
    };
  }

  // -------------------------------------------------------------------------
  // Gap 3 — MIME type and size re-verified against actual S3 object metadata.
  // Gap 2 — ContentLength cross-checked even for POST uploads (defence in depth).
  // -------------------------------------------------------------------------
  async confirmUpload(
    userId: string,
    dto: ConfirmUploadDto,
  ): Promise<{
    success: true;
    data: { confirmed: true; signedUrl: string; key: string };
    error: null;
  }> {
    // Verify key ownership before hitting S3
    if (!this.verifyKeyOwnership(dto.key, userId)) {
      throw new ForbiddenException('Key does not belong to requesting user');
    }

    // HeadObject — verify existence and read actual metadata
    let head: Awaited<ReturnType<typeof this.s3Client.send>>;
    try {
      head = await this.s3Client.send(
        new HeadObjectCommand({
          Bucket: this.bucketName,
          Key: dto.key,
        }),
      );
    } catch (error: unknown) {
      if (isNotFoundError(error)) {
        throw new NotFoundException(
          'Upload not found — file may not have reached S3',
        );
      }
      throw error;
    }

    // Gap 3 — re-verify the Content-Type S3 actually stored
    const storedContentType = (head as { ContentType?: string }).ContentType ?? '';
    const mimeConfig = ALLOWED_MIME_MAP[storedContentType];
    if (!mimeConfig) {
      this.logger.warn(
        `confirmUpload: forbidden content type "${storedContentType}" for key ${dto.key} — deleting`,
      );
      await this.deleteFile(dto.key);
      throw new BadRequestException('Stored content type is not permitted');
    }

    // Gap 2 — defence-in-depth size check against actual stored bytes
    const storedSize = (head as { ContentLength?: number }).ContentLength ?? 0;
    if (storedSize > mimeConfig.maxBytes) {
      this.logger.warn(
        `confirmUpload: oversized object ${storedSize} bytes (max ${mimeConfig.maxBytes}) for key ${dto.key} — deleting`,
      );
      await this.deleteFile(dto.key);
      throw new BadRequestException(
        'Uploaded file exceeds the maximum allowed size',
      );
    }

    const signedUrl = this.getSignedUrl(dto.key);

    this.logger.log(
      `Upload confirmed: key=${dto.key} userId=${userId} size=${storedSize} type=${storedContentType}`,
    );

    return {
      success: true,
      data: { confirmed: true, signedUrl, key: dto.key },
      error: null,
    };
  }

  // -------------------------------------------------------------------------
  // Delete a file from S3 — internal method called by other services.
  // S3 DeleteObject is idempotent; errors are logged but not re-thrown.
  // -------------------------------------------------------------------------
  async deleteFile(key: string): Promise<void> {
    try {
      await this.s3Client.send(
        new DeleteObjectCommand({ Bucket: this.bucketName, Key: key }),
      );
    } catch (error: unknown) {
      // Gap 5 — structured logger with stack trace
      this.logger.warn(
        `Failed to delete S3 object: ${key}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  // -------------------------------------------------------------------------
  // Generate a signed CloudFront URL for an existing key.
  // Public so other services (e.g. submissions) can re-sign on demand.
  // -------------------------------------------------------------------------
  getSignedUrl(key: string): string {
    const url = `https://${this.cloudfrontDomain}/${key}`;

    // Gap 8 — use named constant instead of magic number
    const dateLessThan = new Date(
      Date.now() + SIGNED_CDN_URL_TTL_DAYS * 24 * 60 * 60 * 1000,
    );

    return getCloudfrontSignedUrl({
      url,
      keyPairId: this.cloudfrontKeyPairId,
      privateKey: this.cloudfrontPrivateKey,
      dateLessThan: dateLessThan.toISOString(),
    });
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Build the S3 object key.
   * Format: {folder}/{userId}/{uuid}.{ext}
   * Extension is derived from the MIME map — never from the client filename.
   */
  private generateKey(
    folder: string,
    userId: string,
    fileType: string,
  ): string {
    const ext = ALLOWED_MIME_MAP[fileType]?.ext ?? 'bin';
    const uuid = randomUUID();
    return `${folder}/${userId}/${uuid}.${ext}`;
  }

  /**
   * Verify that the key was issued for this userId.
   * Key format: {folder}/{userId}/{uuid}.{ext} — exactly 3 slash-delimited segments.
   */
  private verifyKeyOwnership(key: string, userId: string): boolean {
    const segments = key.split('/');
    return segments.length === 3 && segments[1] === userId;
  }
}

// ---------------------------------------------------------------------------
// Module-private helpers
// ---------------------------------------------------------------------------

type AllowedFolderUnion = (typeof ALLOWED_FOLDERS)[number];

/** Type-guard for S3 404 errors — works for both error.name and $metadata. */
function isNotFoundError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const err = error as Record<string, unknown>;
  if (err['name'] === 'NotFound') return true;
  const meta = err['$metadata'] as Record<string, unknown> | undefined;
  return meta?.['httpStatusCode'] === 404;
}