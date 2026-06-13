import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { MailService } from './mail.service';
import { Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';

describe('AuthService', () => {
  let service: AuthService;
  let prismaService: PrismaService;
  let jwtService: JwtService;
  let redis: any;

  const mockPrismaService = {
    user: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  };

  const mockJwtService = {
    sign: jest.fn(),
    verify: jest.fn(),
  };

  const mockMailService = {
    sendPasswordResetEmail: jest.fn().mockResolvedValue(undefined),
    send: jest.fn().mockResolvedValue(undefined),
    isConfigured: jest.fn().mockReturnValue(false),
  };

  const mockRedisService = {
    get: jest.fn(),
    setex: jest.fn(),
    del: jest.fn(),
    incr: jest.fn(),
    expire: jest.fn(),
    setNx: jest.fn(),
  };

  const mockConfigService = {
    get: jest.fn((key: string) => {
      if (key === 'TEACHER_REGISTRATION_CODE') return null;
      return null;
    }),
    getOrThrow: jest.fn((key: string) => {
      if (key === 'JWT_SECRET') return 'test-secret';
      if (key === 'JWT_REFRESH_SECRET') return 'test-refresh-secret';
      throw new Error(`Unknown key ${key}`);
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
        {
          provide: JwtService,
          useValue: mockJwtService,
        },
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
        {
          provide: RedisService,
          useValue: mockRedisService,
        },
        {
          provide: MailService,
          useValue: mockMailService,
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    prismaService = module.get<PrismaService>(PrismaService);
    jwtService = module.get<JwtService>(JwtService);
    redis = mockRedisService;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('register', () => {
    const registerDto = {
      email: 'teacher@school.edu',
      password: 'SecurePass123!',
      firstName: 'Jane',
      lastName: 'Doe',
    };

    it('should create a new user and return tokens', async () => {
      const mockUser = {
        id: 'user-id-123',
        email: 'teacher@school.edu',
        role: Role.TEACHER,
        school_id: null,
        password_hash: 'hashed-password',
        is_active: true,
      };

      mockPrismaService.user.findFirst.mockResolvedValue(null);
      mockPrismaService.user.create.mockResolvedValue(mockUser);
      mockPrismaService.user.update.mockResolvedValue(mockUser);
      mockJwtService.sign.mockReturnValueOnce('access-token').mockReturnValueOnce('refresh-token');
      redis.setex.mockResolvedValue('OK');
      jest.spyOn(bcrypt, 'hash').mockResolvedValue('hashed' as never);

      const result = await service.register(registerDto);

      expect(result.success).toBe(true);
      expect(result.data.user.id).toBe('user-id-123');
      expect(result.data.user.email).toBe('teacher@school.edu');
      expect(result.data.accessToken).toBe('access-token');
      expect(result.error).toBeNull();

      expect(prismaService.user.findFirst).toHaveBeenCalledWith({
        where: { email: 'teacher@school.edu', deleted_at: null },
      });
      expect(prismaService.user.create).toHaveBeenCalled();
      expect(prismaService.user.update).toHaveBeenCalledWith({
        where: { id: 'user-id-123' },
        data: { last_login_at: expect.any(Date) },
      });
    });

    it('should hash password with bcrypt salt rounds 12', async () => {
      const mockUser = {
        id: 'user-id-123',
        email: 'teacher@school.edu',
        role: Role.TEACHER,
        school_id: null,
        password_hash: 'hashed-password',
        is_active: true,
      };

      mockPrismaService.user.findFirst.mockResolvedValue(null);
      mockPrismaService.user.create.mockResolvedValue(mockUser);
      mockPrismaService.user.update.mockResolvedValue(mockUser);
      mockJwtService.sign.mockReturnValue('token');
      redis.setex.mockResolvedValue('OK');

      const hashSpy = jest.spyOn(bcrypt, 'hash').mockResolvedValue('hashed' as never);

      await service.register(registerDto);

      expect(hashSpy).toHaveBeenCalledWith('SecurePass123!', 12);
    });

    it('should throw ConflictException if email already exists', async () => {
      const existingUser = {
        id: 'existing-user-id',
        email: 'teacher@school.edu',
        role: Role.TEACHER,
      };

      mockPrismaService.user.findFirst.mockResolvedValue(existingUser);

      await expect(service.register(registerDto)).rejects.toThrow(ConflictException);
      await expect(service.register(registerDto)).rejects.toThrow('Email already in use');

      expect(prismaService.user.create).not.toHaveBeenCalled();
    });

    it('should create user with TEACHER role by default', async () => {
      const mockUser = {
        id: 'user-id-123',
        email: 'teacher@school.edu',
        role: Role.TEACHER,
        school_id: null,
        password_hash: 'hashed-password',
        is_active: true,
      };

      mockPrismaService.user.findFirst.mockResolvedValue(null);
      mockPrismaService.user.create.mockResolvedValue(mockUser);
      mockPrismaService.user.update.mockResolvedValue(mockUser);
      mockJwtService.sign.mockReturnValue('token');
      redis.setex.mockResolvedValue('OK');
      jest.spyOn(bcrypt, 'hash').mockResolvedValue('hashed' as never);

      await service.register(registerDto);

      expect(prismaService.user.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          role: Role.TEACHER,
          is_active: true,
        }),
      });
    });
  });

  describe('login', () => {
    const loginDto = {
      email: 'teacher@school.edu',
      password: 'SecurePass123!',
    };

    const mockUser = {
      id: 'user-id-123',
      email: 'teacher@school.edu',
      password_hash: '$2b$12$hashed-password',
      role: Role.TEACHER,
      school_id: 'school-id-123',
      is_active: true,
      deleted_at: null,
    };

    it('should log in user with correct credentials', async () => {
      mockPrismaService.user.findFirst.mockResolvedValue(mockUser);
      mockPrismaService.user.update.mockResolvedValue(mockUser);
      mockJwtService.sign.mockReturnValueOnce('access-token').mockReturnValueOnce('refresh-token');
      redis.setex.mockResolvedValue('OK');
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(true as never);
      jest.spyOn(bcrypt, 'hash').mockResolvedValue('hashed' as never);

      const result = await service.login(loginDto);

      expect(result.success).toBe(true);
      expect(result.data.user.email).toBe('teacher@school.edu');
      expect(result.data.accessToken).toBe('access-token');
      expect(result.error).toBeNull();

      expect(prismaService.user.update).toHaveBeenCalledWith({
        where: { id: 'user-id-123' },
        data: { last_login_at: expect.any(Date) },
      });
    });

    it('should throw UnauthorizedException if user not found', async () => {
      mockPrismaService.user.findFirst.mockResolvedValue(null);

      await expect(service.login(loginDto)).rejects.toThrow(UnauthorizedException);
      await expect(service.login(loginDto)).rejects.toThrow('Invalid credentials');
    });

    it('should throw UnauthorizedException if password is incorrect', async () => {
      mockPrismaService.user.findFirst.mockResolvedValue(mockUser);
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(false as never);

      await expect(service.login(loginDto)).rejects.toThrow(UnauthorizedException);
      await expect(service.login(loginDto)).rejects.toThrow('Invalid credentials');
    });

    it('should throw UnauthorizedException if user is inactive', async () => {
      const inactiveUser = { ...mockUser, is_active: false };
      mockPrismaService.user.findFirst.mockResolvedValue(inactiveUser);

      await expect(service.login(loginDto)).rejects.toThrow(UnauthorizedException);
      await expect(service.login(loginDto)).rejects.toThrow('Invalid credentials');
    });

    it('should not return password_hash in response', async () => {
      mockPrismaService.user.findFirst.mockResolvedValue(mockUser);
      mockPrismaService.user.update.mockResolvedValue(mockUser);
      mockJwtService.sign.mockReturnValue('token');
      redis.setex.mockResolvedValue('OK');
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(true as never);
      jest.spyOn(bcrypt, 'hash').mockResolvedValue('hashed' as never);

      const result = await service.login(loginDto);

      expect(result.data.user).not.toHaveProperty('password_hash');
    });
  });

  describe('refreshToken', () => {
    const userId = 'user-id-123';
    const refreshToken = 'valid-refresh-token';

    const mockUser = {
      id: userId,
      email: 'teacher@school.edu',
      role: Role.TEACHER,
      school_id: 'school-id-123',
      is_active: true,
      deleted_at: null,
    };

    it('should generate new tokens when refresh token is valid', async () => {
      redis.get.mockResolvedValue('$2b$10$hashed-refresh');
      redis.del.mockResolvedValue(1);
      redis.setex.mockResolvedValue('OK');
      mockPrismaService.user.findFirst.mockResolvedValue(mockUser);
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(true as never);
      jest.spyOn(bcrypt, 'hash').mockResolvedValue('hashed' as never);
      mockJwtService.sign
        .mockReturnValueOnce('new-access-token')
        .mockReturnValueOnce('new-refresh-token');
      mockJwtService.verify = jest.fn().mockReturnValue({ sub: userId });

      const result = await service.refreshToken(userId, refreshToken);

      expect(result.success).toBe(true);
      expect(result.data.accessToken).toBe('new-access-token');
      expect(result.data.refreshToken).toBe('new-refresh-token');
      expect(result.error).toBeNull();

      expect(redis.get).toHaveBeenCalledWith(`refresh:${userId}`);
      expect(redis.del).toHaveBeenCalledWith(`refresh:${userId}`);
      expect(redis.setex).toHaveBeenCalled();
    });

    it('should throw UnauthorizedException if no stored token found', async () => {
      mockJwtService.verify = jest.fn().mockReturnValue({ sub: userId });
      redis.get.mockResolvedValue(null);

      await expect(service.refreshToken(userId, refreshToken)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should throw UnauthorizedException if stored token does not match', async () => {
      mockJwtService.verify = jest.fn().mockReturnValue({ sub: userId });
      redis.get.mockResolvedValue('$2b$10$hashed-refresh');
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(false as never);

      await expect(service.refreshToken(userId, refreshToken)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should throw UnauthorizedException if JWT signature invalid', async () => {
      mockJwtService.verify = jest.fn().mockImplementation(() => {
        throw new Error('invalid signature');
      });

      await expect(service.refreshToken(userId, refreshToken)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should throw UnauthorizedException if user not found', async () => {
      mockJwtService.verify = jest.fn().mockReturnValue({ sub: userId });
      redis.get.mockResolvedValue('$2b$10$hashed-refresh');
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(true as never);
      mockPrismaService.user.findFirst.mockResolvedValue(null);

      await expect(service.refreshToken(userId, refreshToken)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should delete old token before storing new one (token rotation)', async () => {
      mockJwtService.verify = jest.fn().mockReturnValue({ sub: userId });
      redis.get.mockResolvedValue('$2b$10$hashed-refresh');
      redis.del.mockResolvedValue(1);
      redis.setex.mockResolvedValue('OK');
      mockPrismaService.user.findFirst.mockResolvedValue(mockUser);
      mockJwtService.sign.mockReturnValue('token');
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(true as never);
      jest.spyOn(bcrypt, 'hash').mockResolvedValue('hashed' as never);

      await service.refreshToken(userId, refreshToken);

      const delOrder = redis.del.mock.invocationCallOrder[0];
      const setexOrder = redis.setex.mock.invocationCallOrder[0];
      expect(delOrder).toBeLessThan(setexOrder);
    });
  });

  describe('logout', () => {
    it('should delete refresh token from Redis', async () => {
      const userId = 'user-id-123';
      redis.del.mockResolvedValue(1);

      const result = await service.logout(userId);

      expect(result.success).toBe(true);
      expect(result.data.message).toBe('Logged out successfully');
      expect(redis.del).toHaveBeenCalledWith(`refresh:${userId}`);
    });

    it('should return success even if token does not exist', async () => {
      const userId = 'user-id-123';
      redis.del.mockResolvedValue(0);

      const result = await service.logout(userId);

      expect(result.success).toBe(true);
    });
  });

  describe('generateTokens', () => {
    it('should generate access token with 15 minute expiry', async () => {
      const mockUser = {
        id: 'user-id-123',
        email: 'teacher@school.edu',
        role: Role.TEACHER,
        school_id: 'school-id-123',
      };

      mockJwtService.sign.mockReturnValueOnce('access-token').mockReturnValueOnce('refresh-token');
      redis.setex.mockResolvedValue('OK');
      jest.spyOn(bcrypt, 'hash').mockResolvedValue('hashed-refresh' as never);

      await (service as any).generateTokens(mockUser);

      expect(jwtService.sign).toHaveBeenCalledWith(
        expect.objectContaining({
          sub: 'user-id-123',
          email: 'teacher@school.edu',
          role: Role.TEACHER,
          schoolId: 'school-id-123',
        }),
        expect.objectContaining({
          expiresIn: '15m',
        }),
      );
    });

    it('should generate refresh token with 7 day expiry', async () => {
      const mockUser = {
        id: 'user-id-123',
        email: 'teacher@school.edu',
        role: Role.TEACHER,
        school_id: 'school-id-123',
      };

      mockJwtService.sign.mockReturnValueOnce('access-token').mockReturnValueOnce('refresh-token');
      redis.setex.mockResolvedValue('OK');
      jest.spyOn(bcrypt, 'hash').mockResolvedValue('hashed-refresh' as never);

      await (service as any).generateTokens(mockUser);

      expect(jwtService.sign).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({
          expiresIn: '7d',
        }),
      );
    });

    it('should store hashed refresh token in Redis with 7-day TTL', async () => {
      const mockUser = {
        id: 'user-id-123',
        email: 'teacher@school.edu',
        role: Role.TEACHER,
        school_id: 'school-id-123',
      };

      mockJwtService.sign.mockReturnValueOnce('access-token').mockReturnValueOnce('refresh-token');
      redis.setex.mockResolvedValue('OK');
      jest.spyOn(bcrypt, 'hash').mockResolvedValue('hashed-refresh' as never);

      const result = await (service as any).generateTokens(mockUser);

      expect(redis.setex).toHaveBeenCalledWith(
        'refresh:user-id-123',
        7 * 24 * 60 * 60,
        'hashed-refresh',
      );
      // Both tokens returned so controller can set cookie without a second call
      expect(result.accessToken).toBe('access-token');
      expect(result.refreshToken).toBe('refresh-token');
    });
  });

  describe('forgotPassword', () => {
    it('should send reset email when user has a password', async () => {
      mockPrismaService.user.findFirst.mockResolvedValue({
        id: 'user-id-123',
        email: 'teacher@school.edu',
        password_hash: 'hashed',
      });
      redis.setex.mockResolvedValue('OK');

      await service.forgotPassword({ email: 'teacher@school.edu' });

      expect(mockMailService.sendPasswordResetEmail).toHaveBeenCalledWith(
        'teacher@school.edu',
        expect.any(String),
      );
    });

    it('should not send email when user does not exist', async () => {
      mockPrismaService.user.findFirst.mockResolvedValue(null);

      await service.forgotPassword({ email: 'missing@school.edu' });

      expect(mockMailService.sendPasswordResetEmail).not.toHaveBeenCalled();
    });
  });

  describe('createOAuthExchangeCode', () => {
    it('should store a one-time code in Redis', async () => {
      redis.setex.mockResolvedValue('OK');

      const code = await service.createOAuthExchangeCode('user-id-123');

      expect(code).toHaveLength(64);
      expect(redis.setex).toHaveBeenCalledWith(
        `oauth_code:${code}`,
        RedisService.TTL.OAUTH_CODE_SECONDS,
        'user-id-123',
      );
    });
  });

  describe('exchangeOAuthCode', () => {
    it('should exchange a valid code for tokens', async () => {
      const mockUser = {
        id: 'user-id-123',
        email: 'teacher@school.edu',
        role: Role.TEACHER,
        school_id: null,
        is_active: true,
        deleted_at: null,
      };

      redis.get.mockResolvedValue('user-id-123');
      redis.del.mockResolvedValue(1);
      mockPrismaService.user.findFirst.mockResolvedValue(mockUser);
      mockPrismaService.user.update.mockResolvedValue(mockUser);
      mockJwtService.sign
        .mockReturnValueOnce('access-token')
        .mockReturnValueOnce('refresh-token');
      redis.setex.mockResolvedValue('OK');
      jest.spyOn(bcrypt, 'hash').mockResolvedValue('hashed' as never);

      const result = await service.exchangeOAuthCode('valid-code');

      expect(result.success).toBe(true);
      expect(result.data.accessToken).toBe('access-token');
      expect(redis.del).toHaveBeenCalledWith('oauth_code:valid-code');
    });

    it('should throw when code is missing or expired', async () => {
      redis.get.mockResolvedValue(null);

      await expect(service.exchangeOAuthCode('bad-code')).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('validateGoogleUser', () => {
    const googleProfile = {
      googleId: 'google-123',
      email: 'teacher@example.com',
      firstName: 'John',
      lastName: 'Doe',
      profilePhoto: 'https://example.com/photo.jpg',
    };

    it('should return existing user when found by google_id', async () => {
      const existingUser = {
        id: 'user-id-123',
        email: 'teacher@example.com',
        google_id: 'google-123',
        role: Role.TEACHER,
        is_active: true,
        deleted_at: null,
      };

      mockPrismaService.user.findFirst.mockResolvedValueOnce(existingUser);
      mockPrismaService.user.update.mockResolvedValue({
        ...existingUser,
        last_login_at: new Date(),
      });

      const result = await service.validateGoogleUser(googleProfile);

      expect(result).toBeDefined();
      expect(result.email).toBe('teacher@example.com');
      expect(prismaService.user.findFirst).toHaveBeenCalledWith({
        where: { google_id: 'google-123', deleted_at: null },
      });
      expect(prismaService.user.update).toHaveBeenCalledWith({
        where: { id: 'user-id-123' },
        data: { last_login_at: expect.any(Date) },
      });
    });

    it('should link google_id to existing user found by email', async () => {
      const existingUserByEmail = {
        id: 'user-id-456',
        email: 'teacher@example.com',
        google_id: null,
        role: Role.TEACHER,
        is_active: true,
        deleted_at: null,
      };

      // First call by google_id returns null, second call by email returns user
      mockPrismaService.user.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(existingUserByEmail);
      
      mockPrismaService.user.update.mockResolvedValue({
        ...existingUserByEmail,
        google_id: 'google-123',
        last_login_at: new Date(),
      });

      const result = await service.validateGoogleUser(googleProfile);

      expect(result.google_id).toBe('google-123');
      expect(prismaService.user.update).toHaveBeenCalledWith({
        where: { id: 'user-id-456' },
        data: {
          google_id: 'google-123',
          last_login_at: expect.any(Date),
        },
      });
    });

    it('should create new user with TEACHER role if no existing user found', async () => {
      const newUser = {
        id: 'new-user-id',
        email: 'newteacher@example.com',
        google_id: 'google-789',
        role: Role.TEACHER,
        is_active: true,
        deleted_at: null,
        password_hash: null,
        school_id: null,
        clever_id: null,
        last_login_at: new Date(),
        preferred_language: 'en',
        created_at: new Date(),
        updated_at: new Date(),
      };

      // Both findUnique calls return null (not found by google_id or email)
      mockPrismaService.user.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);
      
      mockPrismaService.user.create.mockResolvedValue(newUser);

      const result = await service.validateGoogleUser({
        googleId: 'google-789',
        email: 'newteacher@example.com',
        firstName: 'New',
        lastName: 'Teacher',
      });

      expect(result.id).toBe('new-user-id');
      expect(result.role).toBe(Role.TEACHER);
      expect(result.is_active).toBe(true);
      expect(prismaService.user.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          email: 'newteacher@example.com',
          google_id: 'google-789',
          first_name: 'New',
          last_name: 'Teacher',
          role: Role.TEACHER,
          is_active: true,
          last_login_at: expect.any(Date),
        }),
      });
    });

    it('should throw UnauthorizedException if user account is inactive', async () => {
      const inactiveUser = {
        id: 'user-id-123',
        email: 'teacher@example.com',
        google_id: 'google-123',
        role: Role.TEACHER,
        is_active: false,
        deleted_at: null,
      };

      mockPrismaService.user.findFirst.mockResolvedValueOnce(inactiveUser);
      mockPrismaService.user.update.mockResolvedValue({
        ...inactiveUser,
        last_login_at: new Date(),
      });

      await expect(service.validateGoogleUser(googleProfile)).rejects.toThrow(
        UnauthorizedException,
      );
      await expect(service.validateGoogleUser(googleProfile)).rejects.toThrow(
        'Authentication failed',
      );
    });

    it('should update last_login_at for existing user', async () => {
      const existingUser = {
        id: 'user-id-123',
        email: 'teacher@example.com',
        google_id: 'google-123',
        role: Role.TEACHER,
        is_active: true,
        deleted_at: null,
        last_login_at: new Date('2024-01-01'),
      };

      mockPrismaService.user.findFirst.mockResolvedValueOnce(existingUser);
      mockPrismaService.user.update.mockResolvedValue({
        ...existingUser,
        last_login_at: new Date(),
      });

      await service.validateGoogleUser(googleProfile);

      expect(prismaService.user.update).toHaveBeenCalledWith({
        where: { id: 'user-id-123' },
        data: { last_login_at: expect.any(Date) },
      });
    });
  });

});
