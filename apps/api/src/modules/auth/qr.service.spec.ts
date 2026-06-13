import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import {
  UnauthorizedException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { QrService } from './qr.service';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { Role } from '@prisma/client';
import * as QRCode from 'qrcode';
import { createHash } from 'crypto';

// Mock QRCode
jest.mock('qrcode');

describe('QrService', () => {
  let service: QrService;
  let prismaUser: any;
  let prismaClassStudent: any;
  let jwtService: jest.Mocked<JwtService>;
  let redis: any;

  const mockConfigService = {
    get: jest.fn((key: string) => {
      const config: Record<string, string> = {
        REDIS_URL: 'redis://localhost:6379',
        JWT_SECRET: 'test-secret',
      };
      return config[key];
    }),
  };

  const mockStudent = {
    id: 'student-123',
    email: 'student@example.com',
    role: Role.STUDENT,
    is_active: true,
    school_id: 'school-123',
    deleted_at: null,
    password_hash: null,
    google_id: null,
    clever_id: null,
    last_login_at: new Date(),
    preferred_language: 'en',
    created_at: new Date(),
    updated_at: new Date(),
  };

  const mockTeacher = {
    id: 'teacher-123',
    email: 'teacher@example.com',
    role: Role.TEACHER,
    is_active: true,
    school_id: 'school-123',
  };

  const mockClass = {
    id: 'class-123',
    name: 'Grade 1A',
    class_id: 'class-123',
    class: {
      id: 'class-123',
      name: 'Grade 1A',
    },
  };

  beforeEach(async () => {
    // Mock Redis
    redis = {
      setNx: jest.fn(),
    };

    prismaUser = {
      findUnique: jest.fn(),
      update: jest.fn(),
    };

    prismaClassStudent = {
      findFirst: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QrService,
        {
          provide: PrismaService,
          useValue: {
            user: prismaUser,
            classStudent: prismaClassStudent,
          },
        },
        {
          provide: JwtService,
          useValue: {
            sign: jest.fn(),
            verify: jest.fn(),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: mockConfigService.get,
            getOrThrow: jest.fn((key: string) => {
              if (key === 'JWT_QR_SECRET') return 'test-secret';
              throw new Error(`Missing ${key}`);
            }),
          },
        },
        {
          provide: RedisService,
          useValue: redis,
        },
      ],
    }).compile();

    service = module.get<QrService>(QrService);
    jwtService = module.get(JwtService) as jest.Mocked<JwtService>;

    // Mock QRCode.toDataURL
    (QRCode.toDataURL as jest.Mock).mockResolvedValue('data:image/png;base64,mock');
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('generateQr', () => {
    it('should generate QR code for valid student and teacher', async () => {
      prismaUser.findUnique.mockResolvedValue(mockStudent);
      prismaClassStudent.findFirst.mockResolvedValue(mockClass as any);
      jwtService.sign.mockReturnValue('mock-qr-token');

      const result = await service.generateQr('teacher-123', 'student-123');

      expect(result.success).toBe(true);
      expect(result.data.qrCodeDataUrl).toBe('data:image/png;base64,mock');
      expect(result.data).not.toHaveProperty('token');
      expect(result.data.expiresIn).toBe(60);
      expect(result.data.studentId).toBe('student-123');
      expect(result.data.studentEmail).toBe('student@example.com');

      expect(prismaUser.findUnique).toHaveBeenCalledWith({
        where: {
          id: 'student-123',
          deleted_at: null,
        },
      });

      expect(prismaClassStudent.findFirst).toHaveBeenCalledWith({
        where: {
          student_id: 'student-123',
          is_active: true,
          class: {
            teachers: {
              some: {
                teacher_id: 'teacher-123',
              },
            },
            deleted_at: null,
          },
        },
        include: {
          class: true,
        },
      });

      expect(jwtService.sign).toHaveBeenCalledWith(
        expect.objectContaining({
          studentId: 'student-123',
          classId: 'class-123',
          type: 'QR_LOGIN',
        }),
        expect.objectContaining({
          secret: 'test-secret',
          expiresIn: '60s',
        }),
      );

      expect(QRCode.toDataURL).toHaveBeenCalledWith(
        'mock-qr-token',
        expect.objectContaining({
          errorCorrectionLevel: 'M',
          width: 300,
          margin: 2,
        }),
      );
    });

    it('should throw BadRequestException if student not found', async () => {
      prismaUser.findUnique.mockResolvedValue(null);

      await expect(
        service.generateQr('teacher-123', 'student-123'),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.generateQr('teacher-123', 'student-123'),
      ).rejects.toThrow('Student not found');
    });

    it('should throw BadRequestException if user is not a student', async () => {
      prismaUser.findUnique.mockResolvedValue({
        ...mockStudent,
        role: Role.TEACHER,
      } as any);

      await expect(
        service.generateQr('teacher-123', 'student-123'),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.generateQr('teacher-123', 'student-123'),
      ).rejects.toThrow('User is not a student');
    });

    it('should throw BadRequestException if student account is inactive', async () => {
      prismaUser.findUnique.mockResolvedValue({
        ...mockStudent,
        is_active: false,
      } as any);

      await expect(
        service.generateQr('teacher-123', 'student-123'),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.generateQr('teacher-123', 'student-123'),
      ).rejects.toThrow('Student account is inactive');
    });

    it('should throw ForbiddenException if teacher does not have access to student', async () => {
      prismaUser.findUnique.mockResolvedValue(mockStudent);
      prismaClassStudent.findFirst.mockResolvedValue(null);

      await expect(
        service.generateQr('teacher-123', 'student-123'),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        service.generateQr('teacher-123', 'student-123'),
      ).rejects.toThrow('Teacher does not have access to this student');
    });
  });

  describe('validateQr', () => {
    const mockToken = 'mock-qr-token';
    const mockPayload = {
      studentId: 'student-123',
      classId: 'class-123',
      type: 'QR_LOGIN' as const,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 60,
    };

    it('should validate QR token and return student', async () => {
      jwtService.verify.mockReturnValue(mockPayload);
      redis.setNx.mockResolvedValue(true);
      prismaUser.findUnique.mockResolvedValue(mockStudent);
      prismaUser.update.mockResolvedValue(mockStudent);

      const tokenHash = createHash('sha256').update(mockToken).digest('hex');
      const result = await service.validateQr(mockToken);

      expect(result).toEqual(mockStudent);

      expect(jwtService.verify).toHaveBeenCalledWith(mockToken, {
        secret: 'test-secret',
      });
      expect(redis.setNx).toHaveBeenCalledWith(`used_qr:${tokenHash}`, '1', 60);
      // Step 4 — Student fetched
      expect(prismaUser.findUnique).toHaveBeenCalledWith({
        where: { id: 'student-123', deleted_at: null },
      });
      expect(prismaUser.update).toHaveBeenCalledWith({
        where: { id: 'student-123' },
        data: { last_login_at: expect.any(Date) },
      });
    });

    it('should throw UnauthorizedException if QR code already used', async () => {
      jwtService.verify.mockReturnValue(mockPayload);
      redis.setNx.mockResolvedValue(false);

      await expect(service.validateQr(mockToken)).rejects.toThrow(
        UnauthorizedException,
      );
      await expect(service.validateQr(mockToken)).rejects.toThrow(
        'QR code has already been used',
      );

      expect(jwtService.verify).toHaveBeenCalled();
      expect(prismaUser.findUnique).not.toHaveBeenCalled();
    });

    it('should throw UnauthorizedException if token is invalid', async () => {
      jwtService.verify.mockImplementation(() => {
        throw new Error('Invalid token');
      });

      await expect(service.validateQr(mockToken)).rejects.toThrow(
        UnauthorizedException,
      );
      await expect(service.validateQr(mockToken)).rejects.toThrow(
        'Invalid or expired QR code',
      );
    });

    it('should throw UnauthorizedException if token type is not QR_LOGIN', async () => {
      jwtService.verify.mockReturnValue({
        ...mockPayload,
        type: 'INVALID_TYPE',
      });

      await expect(service.validateQr(mockToken)).rejects.toThrow(
        UnauthorizedException,
      );
      await expect(service.validateQr(mockToken)).rejects.toThrow(
        'Invalid QR code type',
      );

      expect(redis.setNx).not.toHaveBeenCalled();
    });

    it('should throw UnauthorizedException if student not found', async () => {
      redis.setNx.mockResolvedValue(true);
      jwtService.verify.mockReturnValue(mockPayload);
      prismaUser.findUnique.mockResolvedValue(null);

      await expect(service.validateQr(mockToken)).rejects.toThrow(
        UnauthorizedException,
      );
      await expect(service.validateQr(mockToken)).rejects.toThrow(
        'Student not found or inactive',
      );

      expect(redis.setNx).toHaveBeenCalled(); // Token should still be marked as used
    });

    it('should throw UnauthorizedException if student is inactive', async () => {
      redis.setNx.mockResolvedValue(true);
      jwtService.verify.mockReturnValue(mockPayload);
      prismaUser.findUnique.mockResolvedValue({
        ...mockStudent,
        is_active: false,
      } as any);

      await expect(service.validateQr(mockToken)).rejects.toThrow(
        UnauthorizedException,
      );
      await expect(service.validateQr(mockToken)).rejects.toThrow(
        'Student not found or inactive',
      );
    });

    it('should throw UnauthorizedException if user is not a student', async () => {
      redis.setNx.mockResolvedValue(true);
      jwtService.verify.mockReturnValue(mockPayload);
      prismaUser.findUnique.mockResolvedValue({
        ...mockStudent,
        role: Role.TEACHER,
      } as any);

      await expect(service.validateQr(mockToken)).rejects.toThrow(
        UnauthorizedException,
      );
      await expect(service.validateQr(mockToken)).rejects.toThrow(
        'User is not a student',
      );
    });
  });

});
