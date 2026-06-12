import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { UploadsService } from './uploads.service';
import { PresignedUrlDto } from './dto';
import {
  S3Client,
  HeadObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { getSignedUrl as getCloudfrontSignedUrl } from '@aws-sdk/cloudfront-signer';
import { ALLOWED_MIME_MAP } from './uploads.constants';

// ---------------------------------------------------------------------------
// Mock AWS SDK modules
// ---------------------------------------------------------------------------
jest.mock('@aws-sdk/s3-presigned-post');
jest.mock('@aws-sdk/cloudfront-signer');
jest.mock('@aws-sdk/client-s3');

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------
const mockConfigValues: Record<string, string> = {
  AWS_REGION: 'us-east-1',
  AWS_ACCESS_KEY_ID: 'test-key-id',
  AWS_SECRET_ACCESS_KEY: 'test-secret-key',
  S3_BUCKET_NAME: 'test-bucket',
  CLOUDFRONT_DOMAIN: 'test-cdn.cloudfront.net',
  CLOUDFRONT_KEY_PAIR_ID: 'test-key-pair-id',
  CLOUDFRONT_PRIVATE_KEY: 'test-private-key',
};

const MOCK_UPLOAD_URL = 'https://test-bucket.s3.amazonaws.com/';
const MOCK_FIELDS = { key: 'submissions/user-123/uuid.jpg', Policy: 'policy', 'X-Amz-Signature': 'sig' };
const MOCK_SIGNED_CF_URL = 'https://test-cdn.cloudfront.net/signed?sig=abc';

// ---------------------------------------------------------------------------
describe('UploadsService', () => {
  let service: UploadsService;
  let mockS3Client: jest.Mocked<S3Client>;

  beforeEach(async () => {
    mockS3Client = { send: jest.fn() } as unknown as jest.Mocked<S3Client>;
    (S3Client as jest.Mock).mockImplementation(() => mockS3Client);
    (createPresignedPost as jest.Mock).mockResolvedValue({
      url: MOCK_UPLOAD_URL,
      fields: MOCK_FIELDS,
    });
    (getCloudfrontSignedUrl as jest.Mock).mockReturnValue(MOCK_SIGNED_CF_URL);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UploadsService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => mockConfigValues[key]),
          },
        },
      ],
    }).compile();

    service = module.get<UploadsService>(UploadsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // =========================================================================
  // onModuleInit — startup config validation (Gap 12)
  // =========================================================================
  describe('onModuleInit', () => {
    it('should not throw when all required config keys are present', () => {
      expect(() => service.onModuleInit()).not.toThrow();
    });

    it('should throw when a required config key is missing', async () => {
      const module = await Test.createTestingModule({
        providers: [
          UploadsService,
          {
            provide: ConfigService,
            useValue: {
              // S3_BUCKET_NAME deliberately absent
              get: jest.fn((key: string) =>
                key === 'S3_BUCKET_NAME' ? undefined : mockConfigValues[key],
              ),
            },
          },
        ],
      }).compile();

      const svc = module.get<UploadsService>(UploadsService);
      expect(() => svc.onModuleInit()).toThrow(
        'missing required configuration key "S3_BUCKET_NAME"',
      );
    });
  });

  // =========================================================================
  // generatePresignedUrl (Gap 1 + Gap 2 — presigned POST)
  // =========================================================================
  describe('generatePresignedUrl', () => {
    const userId = 'user-123';
    const validDto: PresignedUrlDto = {
      fileName: 'test-image.jpg',
      fileType: 'image/jpeg',
      folder: 'submissions',
      fileSizeBytes: 1024 * 1024, // 1 MB
    };

    it('should return presigned POST url and fields for a valid request', async () => {
      const result = await service.generatePresignedUrl(userId, validDto);

      expect(result.success).toBe(true);
      expect(result.data.uploadUrl).toBe(MOCK_UPLOAD_URL);
      expect(result.data.fields).toEqual(MOCK_FIELDS);
      expect(result.data.key).toMatch(/^submissions\/user-123\/[a-f0-9-]+\.jpg$/);
      expect(result.data.expiresAt).toBeDefined();
      expect(result.error).toBeNull();

      // Verify response does NOT include cdnUrl (Gap 10)
      expect((result.data as Record<string, unknown>)['cdnUrl']).toBeUndefined();
    });

    it('should call createPresignedPost with Content-Type and content-length-range conditions', async () => {
      await service.generatePresignedUrl(userId, validDto);

      expect(createPresignedPost).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          Conditions: expect.arrayContaining([
            { 'Content-Type': 'image/jpeg' },
            ['content-length-range', 1, 50 * 1024 * 1024],
          ]),
        }),
      );
    });

    it('should throw BadRequestException for invalid folder', async () => {
      const dto = { ...validDto, folder: 'invalid-folder' };
      await expect(service.generatePresignedUrl(userId, dto)).rejects.toThrow(
        new BadRequestException('Invalid folder'),
      );
    });

    it('should throw BadRequestException for invalid MIME type', async () => {
      const dto = { ...validDto, fileType: 'application/exe' };
      await expect(service.generatePresignedUrl(userId, dto)).rejects.toThrow(
        new BadRequestException('File type not permitted'),
      );
    });

    it('should throw BadRequestException when declared size exceeds MIME-specific limit', async () => {
      const dto = { ...validDto, fileSizeBytes: 51 * 1024 * 1024 }; // jpeg max = 50 MB
      await expect(service.generatePresignedUrl(userId, dto)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.generatePresignedUrl(userId, dto)).rejects.toThrow(
        /File size exceeds maximum/,
      );
    });

    it('should accept declared size exactly at the MIME-specific limit', async () => {
      const dto = { ...validDto, fileSizeBytes: 50 * 1024 * 1024 };
      const result = await service.generatePresignedUrl(userId, dto);
      expect(result.success).toBe(true);
    });

    it('should generate correct key format {folder}/{userId}/{uuid}.{ext}', async () => {
      const result = await service.generatePresignedUrl(userId, validDto);
      expect(result.data.key).toMatch(/^submissions\/user-123\/[a-f0-9-]{36}\.jpg$/);
    });

    // Gap 11 — each MIME type hits the correct maxBytes boundary
    describe('MIME-specific size limits', () => {
      const cases = Object.entries(ALLOWED_MIME_MAP).map(([mimeType, cfg]) => ({
        mimeType,
        maxBytes: cfg.maxBytes,
      }));

      test.each(cases)(
        '$mimeType: rejects at maxBytes + 1',
        async ({ mimeType, maxBytes }) => {
          const dto: PresignedUrlDto = {
            fileName: 'file',
            fileType: mimeType,
            folder: 'submissions',
            fileSizeBytes: maxBytes + 1,
          };
          await expect(
            service.generatePresignedUrl(userId, dto),
          ).rejects.toThrow(BadRequestException);
        },
      );

      test.each(cases)(
        '$mimeType: accepts exactly at maxBytes',
        async ({ mimeType, maxBytes }) => {
          const dto: PresignedUrlDto = {
            fileName: 'file',
            fileType: mimeType,
            folder: 'submissions',
            fileSizeBytes: maxBytes,
          };
          const result = await service.generatePresignedUrl(userId, dto);
          expect(result.success).toBe(true);
        },
      );
    });
  });

  // =========================================================================
  // confirmUpload
  // =========================================================================
  describe('confirmUpload', () => {
    const userId = 'user-123';
    const validKey = 'submissions/user-123/550e8400-e29b-41d4-a716-446655440000.jpg';
    const confirmDto = { key: validKey };

    const okHead = {
      ContentType: 'image/jpeg',
      ContentLength: 1024 * 1024, // 1 MB — well within 50 MB limit
    };

    it('should confirm upload and return signed CloudFront URL', async () => {
      (mockS3Client.send as jest.Mock).mockResolvedValue(okHead);

      const result = await service.confirmUpload(userId, confirmDto);

      expect(result.success).toBe(true);
      expect(result.data.confirmed).toBe(true);
      expect(result.data.signedUrl).toBe(MOCK_SIGNED_CF_URL);
      expect(result.data.key).toBe(validKey);
      expect(result.error).toBeNull();
      expect(mockS3Client.send).toHaveBeenCalledWith(expect.any(HeadObjectCommand));
    });

    it('should throw ForbiddenException when key does not belong to user', async () => {
      const wrongDto = { key: 'submissions/different-user/uuid.jpg' };

      await expect(service.confirmUpload(userId, wrongDto)).rejects.toThrow(
        new ForbiddenException('Key does not belong to requesting user'),
      );
      expect(mockS3Client.send).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException when file does not exist in S3 (error.name)', async () => {
      const err: Error & { name: string } = Object.assign(new Error('Not Found'), {
        name: 'NotFound',
      });
      (mockS3Client.send as jest.Mock).mockRejectedValue(err);

      await expect(service.confirmUpload(userId, confirmDto)).rejects.toThrow(
        new NotFoundException('Upload not found — file may not have reached S3'),
      );
    });

    it('should throw NotFoundException when file does not exist in S3 ($metadata)', async () => {
      const err = Object.assign(new Error('Some error'), {
        $metadata: { httpStatusCode: 404 },
      });
      (mockS3Client.send as jest.Mock).mockRejectedValue(err);

      await expect(service.confirmUpload(userId, confirmDto)).rejects.toThrow(NotFoundException);
    });

    it('should propagate non-404 S3 errors', async () => {
      (mockS3Client.send as jest.Mock).mockRejectedValue(new Error('S3 Internal Error'));
      await expect(service.confirmUpload(userId, confirmDto)).rejects.toThrow('S3 Internal Error');
    });

    // Gap 11 — Gap 3: forbidden content type stored in S3
    it('should delete the object and throw BadRequestException when S3 ContentType is not in ALLOWED_MIME_MAP', async () => {
      (mockS3Client.send as jest.Mock)
        .mockResolvedValueOnce({ ContentType: 'application/x-executable', ContentLength: 1024 }) // HeadObject
        .mockResolvedValueOnce({}) // DeleteObject (called by deleteFile)
        ;

      await expect(service.confirmUpload(userId, confirmDto)).rejects.toThrow(
        new BadRequestException('Stored content type is not permitted'),
      );

      // deleteFile must have been called
      expect(mockS3Client.send).toHaveBeenCalledWith(expect.any(DeleteObjectCommand));
    });

    // Gap 11 — Gap 2: object larger than MIME-specific limit
    it('should delete the object and throw BadRequestException when stored ContentLength exceeds limit', async () => {
      (mockS3Client.send as jest.Mock)
        .mockResolvedValueOnce({ ContentType: 'image/jpeg', ContentLength: 51 * 1024 * 1024 }) // HeadObject
        .mockResolvedValueOnce({}) // DeleteObject
        ;

      await expect(service.confirmUpload(userId, confirmDto)).rejects.toThrow(
        new BadRequestException('Uploaded file exceeds the maximum allowed size'),
      );

      expect(mockS3Client.send).toHaveBeenCalledWith(expect.any(DeleteObjectCommand));
    });

    // Gap 11 — reject key with wrong segment count
    it('should throw ForbiddenException for key with fewer than 3 segments', async () => {
      const badDto = { key: 'submissions/user-123' };
      await expect(service.confirmUpload(userId, badDto)).rejects.toThrow(ForbiddenException);
    });

    // Gap 11 — getSignedUrl propagates when CloudFront signer throws
    it('should propagate error when getCloudfrontSignedUrl throws', async () => {
      (mockS3Client.send as jest.Mock).mockResolvedValue(okHead);
      (getCloudfrontSignedUrl as jest.Mock).mockImplementation(() => {
        throw new Error('CF signer error');
      });

      await expect(service.confirmUpload(userId, confirmDto)).rejects.toThrow('CF signer error');
    });
  });

  // =========================================================================
  // deleteFile
  // =========================================================================
  describe('deleteFile', () => {
    const key = 'submissions/user-123/file.jpg';

    it('should send DeleteObjectCommand', async () => {
      (mockS3Client.send as jest.Mock).mockResolvedValue({});
      await service.deleteFile(key);
      expect(mockS3Client.send).toHaveBeenCalledWith(expect.any(DeleteObjectCommand));
    });

    it('should not throw when the file does not exist (idempotent)', async () => {
      (mockS3Client.send as jest.Mock).mockRejectedValue(
        Object.assign(new Error('Not Found'), { name: 'NotFound' }),
      );
      await expect(service.deleteFile(key)).resolves.not.toThrow();
    });

    it('should log but not throw on arbitrary S3 error', async () => {
      const warnSpy = jest.spyOn(service['logger'], 'warn').mockImplementation();
      (mockS3Client.send as jest.Mock).mockRejectedValue(new Error('S3 Error'));

      await service.deleteFile(key);

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to delete S3 object'),
        expect.any(String), // stack trace string
      );
      warnSpy.mockRestore();
    });
  });

  // =========================================================================
  // getSignedUrl
  // =========================================================================
  describe('getSignedUrl', () => {
    const key = 'submissions/user-123/file.jpg';

    it('should generate a signed CloudFront URL', () => {
      const result = service.getSignedUrl(key);
      expect(result).toBe(MOCK_SIGNED_CF_URL);
      expect(getCloudfrontSignedUrl).toHaveBeenCalledWith({
        url: `https://test-cdn.cloudfront.net/${key}`,
        keyPairId: mockConfigValues['CLOUDFRONT_KEY_PAIR_ID'],
        privateKey: mockConfigValues['CLOUDFRONT_PRIVATE_KEY'],
        dateLessThan: expect.any(String),
      });
    });

    it('should set expiry to approximately 7 days from now', () => {
      const before = Date.now();
      service.getSignedUrl(key);
      const after = Date.now();

      const [[{ dateLessThan }]] = (getCloudfrontSignedUrl as jest.Mock).mock.calls;
      const expiry = new Date(dateLessThan as string).getTime();
      const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;

      expect(expiry).toBeGreaterThanOrEqual(before + sevenDaysMs);
      expect(expiry).toBeLessThanOrEqual(after + sevenDaysMs + 1000);
    });
  });
});