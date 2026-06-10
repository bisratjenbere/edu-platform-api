import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { getSignedUrl as getCloudfrontSignedUrl } from '@aws-sdk/cloudfront-signer';
import { randomUUID } from 'crypto';
import { PresignedUrlDto, ConfirmUploadDto } from './dto';
import { ALLOWED_MIME_MAP, ALLOWED_FOLDERS } from './uploads.constants';

@Injectable()
export class UploadsService {
  private s3Client: S3Client;
  private bucketName: string;
  private cloudfrontDomain: string;
  private cloudfrontKeyPairId: string;
  private cloudfrontPrivateKey: string;

  constructor(private configService: ConfigService) {
    // Initialize S3 client
    this.s3Client = new S3Client({
      region: this.configService.get<string>('AWS_REGION'),
      credentials: {
        accessKeyId: this.configService.get<string>('AWS_ACCESS_KEY_ID') || '',
        secretAccessKey:
          this.configService.get<string>('AWS_SECRET_ACCESS_KEY') || '',
      },
    });

    this.bucketName = this.configService.get<string>('S3_BUCKET_NAME') || '';
    this.cloudfrontDomain =
      this.configService.get<string>('CLOUDFRONT_DOMAIN') || '';
    this.cloudfrontKeyPairId =
      this.configService.get<string>('CLOUDFRONT_KEY_PAIR_ID') || '';
    this.cloudfrontPrivateKey =
      this.configService.get<string>('CLOUDFRONT_PRIVATE_KEY') || '';
  }

  /**
   * Generate presigned S3 PUT URL for direct browser upload
   */
  async generatePresignedUrl(userId: string, dto: PresignedUrlDto) {
    // Validate folder (redundant with DTO validation, but explicit check)
    if (!ALLOWED_FOLDERS.includes(dto.folder as any)) {
      throw new BadRequestException('Invalid folder');
    }

    // Validate file type
    if (!ALLOWED_MIME_MAP[dto.fileType]) {
      throw new BadRequestException('File type not permitted');
    }

    // Validate file size against MIME-specific limit
    const mimeConfig = ALLOWED_MIME_MAP[dto.fileType];
    if (dto.fileSizeBytes > mimeConfig.maxBytes) {
      throw new BadRequestException(
        `File size exceeds maximum for ${dto.fileType} (${mimeConfig.maxBytes / (1024 * 1024)} MB)`,
      );
    }

    // Generate S3 key
    const key = this.generateKey(dto.folder, userId, dto.fileName, dto.fileType);

    // Create presigned PUT URL
    const command = new PutObjectCommand({
      Bucket: this.bucketName,
      Key: key,
      ContentType: dto.fileType,
    });

    const uploadUrl = await getSignedUrl(this.s3Client, command, {
      expiresIn: 60, // 60 seconds
    });

    // Generate CDN URL (unsigned for now, will be signed on confirm)
    const cdnUrl = `https://${this.cloudfrontDomain}/${key}`;

    // Calculate expiry time
    const expiresAt = new Date(Date.now() + 60 * 1000).toISOString();

    return {
      success: true,
      data: {
        uploadUrl,
        key,
        cdnUrl,
        expiresAt,
      },
      error: null,
    };
  }

  /**
   * Confirm upload completion and generate signed CloudFront URL
   */
  async confirmUpload(userId: string, dto: ConfirmUploadDto) {
    // Verify key ownership
    if (!this.verifyKeyOwnership(dto.key, userId)) {
      throw new ForbiddenException('Key does not belong to requesting user');
    }

    // Verify file exists in S3
    try {
      await this.s3Client.send(
        new HeadObjectCommand({
          Bucket: this.bucketName,
          Key: dto.key,
        }),
      );
    } catch (error: any) {
      if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
        throw new NotFoundException(
          'Upload not found — file may not have reached S3',
        );
      }
      throw error;
    }

    // Generate CloudFront signed URL (7-day expiry)
    const signedUrl = this.getSignedUrl(dto.key);

    return {
      success: true,
      data: {
        confirmed: true,
        signedUrl,
        key: dto.key,
      },
      error: null,
    };
  }

  /**
   * Delete a file from S3 (internal method, called by other services)
   */
  async deleteFile(key: string): Promise<void> {
    try {
      await this.s3Client.send(
        new DeleteObjectCommand({
          Bucket: this.bucketName,
          Key: key,
        }),
      );
    } catch (error) {
      // S3 delete is idempotent — no error if key doesn't exist
      // Log error but don't throw
      console.warn(`Failed to delete S3 object: ${key}`, error);
    }
  }

  /**
   * Generate signed CloudFront URL for an existing key (internal method)
   */
  getSignedUrl(key: string): string {
    const url = `https://${this.cloudfrontDomain}/${key}`;
    
    // Calculate expiry (7 days from now)
    const dateLessThan = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    const signedUrl = getCloudfrontSignedUrl({
      url,
      keyPairId: this.cloudfrontKeyPairId,
      privateKey: this.cloudfrontPrivateKey,
      dateLessThan: dateLessThan.toISOString(),
    });

    return signedUrl;
  }

  /**
   * Generate S3 key from folder, userId, fileName, and fileType
   * Format: {folder}/{userId}/{uuid}.{ext}
   */
  private generateKey(
    folder: string,
    userId: string,
    fileName: string,
    fileType: string,
  ): string {
    // Derive extension from MIME type (not from filename)
    const ext = ALLOWED_MIME_MAP[fileType]?.ext ?? 'bin';
    const uuid = randomUUID();
    return `${folder}/${userId}/${uuid}.${ext}`;
  }

  /**
   * Verify that the key belongs to the requesting user
   * Key format: {folder}/{userId}/{uuid}.{ext}
   */
  private verifyKeyOwnership(key: string, userId: string): boolean {
    const segments = key.split('/');
    // segments[0] = folder, segments[1] = userId, segments[2] = filename
    return segments.length === 3 && segments[1] === userId;
  }
}
