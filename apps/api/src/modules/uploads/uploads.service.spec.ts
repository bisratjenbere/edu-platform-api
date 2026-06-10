import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { UploadsService } from './uploads.service';
import { PresignedUrlDto } from './dto';
import { S3Client, HeadObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { getSignedUrl as getCloudfrontSignedUrl } from '@aws-sdk/cloudfront-signer';

// Mock AWS SDK modules
jest.mock('@aws-sdk/s3-request-presigner');
jest.mock('@aws-sdk/cloudfront-signer');
jest.mock('@aws-sdk/client-s3');

describe('UploadsService', () => {
  let service: UploadsService;
  let configService: ConfigService;
  let mockS3Client: jest.Mocked<S3Client>;

  const mockConfigValues = {
    AWS_REGION: 'us-east-1',
    AWS_ACCESS_KEY_ID: 'test-key-id',
    AWS_SECRET_ACCESS_KEY: 'test-secret-key',
    S3_BUCKET_NAME: 'test-bucket',
    CLOUDFRONT_DOMAIN: 'test-cdn.cloudfront.net',
    CLOUDFRONT_KEY_PAIR_ID: 'test-key-pair-id',
    CLOUDFRONT_PRIVATE_KEY: 'test-private-key',
  };

  beforeEach(async () => {
    // Mock S3Client
    mockS3Client = {
      send: jest.fn(),
    } as unknown as jest.Mocked<S3Client>;

    (S3Client as jest.Mock).mockImplementation(() => mockS3Client);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UploadsService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => mockConfigValues[key as keyof typeof mockConfigValues]),
          },
        },
      ],
    }).compile();

    service = module.get<UploadsService>(UploadsService);
    configService = module.get<ConfigService>(ConfigService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('generatePresignedUrl', () => {
    const validDto: PresignedUrlDto = {
      fileName: 'test-image.jpg',
      fileType: 'image/jpeg',
      folder: 'submissions',
      fileSizeBytes: 1024 * 1024, // 1 MB
    };

    const userId = 'user-123';

    it('should generate presigned URL for valid request', async () => {
      const mockUploadUrl = 'https://test-bucket.s3.amazonaws.com/presigned-url';
      (getSignedUrl as jest.Mock).mockResolvedValue(mockUploadUrl);

      const result = await service.generatePresignedUrl(userId, validDto);

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data.uploadUrl).toBe(mockUploadUrl);
      expect(result.data.key).toMatch(/^submissions\/user-123\/[a-f0-9-]+\.jpg$/);
      expect(result.data.cdnUrl).toMatch(/^https:\/\/test-cdn\.cloudfront\.net\//);
      expect(result.data.expiresAt).toBeDefined();
      expect(result.error).toBeNull();

      // Verify getSignedUrl was called with correct expiry
      expect(getSignedUrl).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        { expiresIn: 60 },
      );
    });

    it('should throw BadRequestException for invalid folder', async () => {
      const invalidDto = { ...validDto, folder: 'invalid-folder' };

      await expect(service.generatePresignedUrl(userId, invalidDto)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.generatePresignedUrl(userId, invalidDto)).rejects.toThrow(
        'Invalid folder',
      );
    });

    it('should throw BadRequestException for invalid MIME type', async () => {
      const invalidDto = { ...validDto, fileType: 'application/exe' };

      await expect(service.generatePresignedUrl(userId, invalidDto)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.generatePresignedUrl(userId, invalidDto)).rejects.toThrow(
        'File type not permitted',
      );
    });

    it('should throw BadRequestException when file size exceeds MIME-specific limit', async () => {
      // image/jpeg has 50 MB limit
      const oversizedDto = { ...validDto, fileSizeBytes: 51 * 1024 * 1024 };

      await expect(service.generatePresignedUrl(userId, oversizedDto)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.generatePresignedUrl(userId, oversizedDto)).rejects.toThrow(
        /File size exceeds maximum/,
      );
    });

    it('should accept file size at exact limit', async () => {
      const mockUploadUrl = 'https://test-bucket.s3.amazonaws.com/presigned-url';
      (getSignedUrl as jest.Mock).mockResolvedValue(mockUploadUrl);

      // image/jpeg has 50 MB limit
      const atLimitDto = { ...validDto, fileSizeBytes: 50 * 1024 * 1024 };

      const result = await service.generatePresignedUrl(userId, atLimitDto);

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
    });

    it('should generate correct key format', async () => {
      const mockUploadUrl = 'https://test-bucket.s3.amazonaws.com/presigned-url';
      (getSignedUrl as jest.Mock).mockResolvedValue(mockUploadUrl);

      const result = await service.generatePresignedUrl(userId, validDto);

      // Key format: {folder}/{userId}/{uuid}.{ext}
      const keyPattern = /^submissions\/user-123\/[a-f0-9-]{36}\.jpg$/;
      expect(result.data.key).toMatch(keyPattern);
    });
  });

  describe('confirmUpload', () => {
    const userId = 'user-123';
    const validKey = 'submissions/user-123/550e8400-e29b-41d4-a716-446655440000.jpg';
    const confirmDto = { key: validKey };

    it('should confirm upload and return signed CloudFront URL', async () => {
      // Mock S3 HeadObjectCommand success
      (mockS3Client.send as jest.Mock).mockResolvedValue({});

      const mockSignedUrl = 'https://test-cdn.cloudfront.net/signed-url';
      (getCloudfrontSignedUrl as jest.Mock).mockReturnValue(mockSignedUrl);

      const result = await service.confirmUpload(userId, confirmDto);

      expect(result.success).toBe(true);
      expect(result.data.confirmed).toBe(true);
      expect(result.data.signedUrl).toBe(mockSignedUrl);
      expect(result.data.key).toBe(validKey);
      expect(result.error).toBeNull();

      // Verify HeadObjectCommand was called
      expect(mockS3Client.send).toHaveBeenCalledWith(expect.any(HeadObjectCommand));
    });

    it('should throw ForbiddenException when key does not belong to user', async () => {
      const wrongUserKey = 'submissions/different-user/550e8400-e29b-41d4-a716-446655440000.jpg';
      const wrongDto = { key: wrongUserKey };

      await expect(service.confirmUpload(userId, wrongDto)).rejects.toThrow(
        ForbiddenException,
      );
      await expect(service.confirmUpload(userId, wrongDto)).rejects.toThrow(
        'Key does not belong to requesting user',
      );

      // Verify S3 was never called
      expect(mockS3Client.send).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException when file does not exist in S3', async () => {
      // Mock S3 HeadObjectCommand 404 error
      const notFoundError: any = new Error('Not Found');
      notFoundError.name = 'NotFound';
      notFoundError.$metadata = { httpStatusCode: 404 };
      (mockS3Client.send as jest.Mock).mockRejectedValue(notFoundError);

      await expect(service.confirmUpload(userId, confirmDto)).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.confirmUpload(userId, confirmDto)).rejects.toThrow(
        'Upload not found — file may not have reached S3',
      );
    });

    it('should handle S3 HeadObjectCommand 404 by $metadata', async () => {
      // Mock S3 404 error using $metadata only
      const notFoundError: any = new Error('Some error');
      notFoundError.$metadata = { httpStatusCode: 404 };
      (mockS3Client.send as jest.Mock).mockRejectedValue(notFoundError);

      await expect(service.confirmUpload(userId, confirmDto)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should propagate other S3 errors', async () => {
      // Mock S3 error that is not 404
      const otherError = new Error('S3 Internal Error');
      (mockS3Client.send as jest.Mock).mockRejectedValue(otherError);

      await expect(service.confirmUpload(userId, confirmDto)).rejects.toThrow(
        'S3 Internal Error',
      );
    });

    it('should verify key ownership with correct format', async () => {
      (mockS3Client.send as jest.Mock).mockResolvedValue({});
      (getCloudfrontSignedUrl as jest.Mock).mockReturnValue('https://signed-url');

      // Valid key with 3 segments: folder/userId/filename
      const result = await service.confirmUpload(userId, confirmDto);
      expect(result.success).toBe(true);
    });

    it('should reject key with incorrect segment count', async () => {
      const invalidKey = 'submissions/user-123'; // Only 2 segments
      const invalidDto = { key: invalidKey };

      await expect(service.confirmUpload(userId, invalidDto)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('deleteFile', () => {
    it('should delete file from S3', async () => {
      const key = 'submissions/user-123/file.jpg';
      (mockS3Client.send as jest.Mock).mockResolvedValue({});

      await service.deleteFile(key);

      expect(mockS3Client.send).toHaveBeenCalledWith(expect.any(DeleteObjectCommand));
    });

    it('should not throw error when file does not exist (idempotent)', async () => {
      const key = 'submissions/user-123/non-existent.jpg';
      const notFoundError: any = new Error('Not Found');
      notFoundError.name = 'NotFound';
      (mockS3Client.send as jest.Mock).mockRejectedValue(notFoundError);

      // Should not throw
      await expect(service.deleteFile(key)).resolves.not.toThrow();
    });

    it('should log error but not throw on S3 failure', async () => {
      const key = 'submissions/user-123/file.jpg';
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();
      (mockS3Client.send as jest.Mock).mockRejectedValue(new Error('S3 Error'));

      await service.deleteFile(key);

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to delete S3 object'),
        expect.any(Error),
      );

      consoleWarnSpy.mockRestore();
    });
  });

  describe('getSignedUrl', () => {
    it('should generate signed CloudFront URL', () => {
      const key = 'submissions/user-123/file.jpg';
      const mockSignedUrl = 'https://test-cdn.cloudfront.net/signed-url?signature=abc';
      (getCloudfrontSignedUrl as jest.Mock).mockReturnValue(mockSignedUrl);

      const result = service.getSignedUrl(key);

      expect(result).toBe(mockSignedUrl);
      expect(getCloudfrontSignedUrl).toHaveBeenCalledWith({
        url: `https://test-cdn.cloudfront.net/${key}`,
        keyPairId: mockConfigValues.CLOUDFRONT_KEY_PAIR_ID,
        privateKey: mockConfigValues.CLOUDFRONT_PRIVATE_KEY,
        dateLessThan: expect.any(String),
      });
    });

    it('should set expiry to 7 days from now', () => {
      const key = 'submissions/user-123/file.jpg';
      (getCloudfrontSignedUrl as jest.Mock).mockReturnValue('https://signed-url');

      const beforeCall = Date.now();
      service.getSignedUrl(key);
      const afterCall = Date.now();

      const callArgs = (getCloudfrontSignedUrl as jest.Mock).mock.calls[0][0];
      const expiryDate = new Date(callArgs.dateLessThan);
      const expiryTimestamp = expiryDate.getTime();

      // Verify expiry is approximately 7 days from now (with 1 second tolerance)
      const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
      const expectedMin = beforeCall + sevenDaysMs;
      const expectedMax = afterCall + sevenDaysMs + 1000;

      expect(expiryTimestamp).toBeGreaterThanOrEqual(expectedMin);
      expect(expiryTimestamp).toBeLessThanOrEqual(expectedMax);
    });
  });
});
