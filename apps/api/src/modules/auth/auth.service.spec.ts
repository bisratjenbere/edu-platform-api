import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { PrismaService } from '../../prisma/prisma.service';
import { Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';

// Mock ioredis
jest.mock('ioredis', () => {
  const mockRedis = {
    get: jest.fn(),
    setex: jest.fn(),
    del: jest.fn(),
    quit: jest.fn(),
  };
  return {
    Redis: jest.fn(() => mockRedis),
    default: jest.fn(() => mockRedis),
  };
});

describe('AuthService', () => {
  let service: AuthService;
  let prismaService: PrismaService;
  let jwtService: JwtService;
  let redis: any;

  const mockPrismaService = {
    user: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  };

  const mockJwtService = {
    sign: jest.fn(),
    verify: jest.fn(),
  };

  const mockConfigService = {
    get: jest.fn((key: string) => {
      if (key === 'JWT_SECRET') return 'test-secret';
      if (key === 'JWT_REFRESH_SECRET') return 'test-refresh-secret';
      if (key === 'REDIS_URL') return 'redis://localhost:6379';
      return null;
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
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    prismaService = module.get<PrismaService>(PrismaService);
    jwtService = module.get<JwtService>(JwtService);
    
    // Get Redis mock instance
    redis = (service as any).redis;
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

      mockPrismaService.user.findUnique.mockResolvedValue(null);
      mockPrismaService.user.create.mockResolvedValue(mockUser);
      mockPrismaService.user.update.mockResolvedValue(mockUser);
      mockJwtService.sign.mockReturnValueOnce('access-token').mockReturnValueOnce('refresh-token');
      redis.setex.mockResolvedValue('OK');

      const result = await service.register(registerDto);

      expect(result.success).toBe(true);
      expect(result.data.user.id).toBe('user-id-123');
      expect(result.data.user.email).toBe('teacher@school.edu');
      expect(result.data.accessToken).toBe('access-token');
      expect(result.error).toBeNull();

      expect(prismaService.user.findUnique).toHaveBeenCalledWith({
        where: { email: 'teacher@school.edu' },
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

      mockPrismaService.user.findUnique.mockResolvedValue(null);
      mockPrismaService.user.create.mockResolvedValue(mockUser);
      mockPrismaService.user.update.mockResolvedValue(mockUser);
      mockJwtService.sign.mockReturnValue('token');
      redis.setex.mockResolvedValue('OK');

      const hashSpy = jest.spyOn(bcrypt, 'hash');

      await service.register(registerDto);

      expect(hashSpy).toHaveBeenCalledWith('SecurePass123!', 12);
    });

    it('should throw ConflictException if email already exists', async () => {
      const existingUser = {
        id: 'existing-user-id',
        email: 'teacher@school.edu',
        role: Role.TEACHER,
      };

      mockPrismaService.user.findUnique.mockResolvedValue(existingUser);

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

      mockPrismaService.user.findUnique.mockResolvedValue(null);
      mockPrismaService.user.create.mockResolvedValue(mockUser);
      mockPrismaService.user.update.mockResolvedValue(mockUser);
      mockJwtService.sign.mockReturnValue('token');
      redis.setex.mockResolvedValue('OK');

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
      mockPrismaService.user.findUnique.mockResolvedValue(mockUser);
      mockPrismaService.user.update.mockResolvedValue(mockUser);
      mockJwtService.sign.mockReturnValueOnce('access-token').mockReturnValueOnce('refresh-token');
      redis.setex.mockResolvedValue('OK');
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(true as never);

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
      mockPrismaService.user.findUnique.mockResolvedValue(null);

      await expect(service.login(loginDto)).rejects.toThrow(UnauthorizedException);
      await expect(service.login(loginDto)).rejects.toThrow('Invalid credentials');
    });

    it('should throw UnauthorizedException if password is incorrect', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(mockUser);
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(false as never);

      await expect(service.login(loginDto)).rejects.toThrow(UnauthorizedException);
      await expect(service.login(loginDto)).rejects.toThrow('Invalid credentials');
    });

    it('should throw UnauthorizedException if user is inactive', async () => {
      const inactiveUser = { ...mockUser, is_active: false };
      mockPrismaService.user.findUnique.mockResolvedValue(inactiveUser);

      await expect(service.login(loginDto)).rejects.toThrow(UnauthorizedException);
      await expect(service.login(loginDto)).rejects.toThrow('Account is inactive');
    });

    it('should not return password_hash in response', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(mockUser);
      mockPrismaService.user.update.mockResolvedValue(mockUser);
      mockJwtService.sign.mockReturnValue('token');
      redis.setex.mockResolvedValue('OK');
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(true as never);

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
      // Service stores plain token (no hashing) and compares directly
      redis.get.mockResolvedValue(refreshToken);
      redis.del.mockResolvedValue(1);
      redis.setex.mockResolvedValue('OK');
      mockPrismaService.user.findUnique.mockResolvedValue(mockUser);
      mockJwtService.sign
        .mockReturnValueOnce('new-access-token')
        .mockReturnValueOnce('new-refresh-token');
      // Mock jwtService.verify to not throw
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
      redis.get.mockResolvedValue('different-token');

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
      redis.get.mockResolvedValue(refreshToken);
      mockPrismaService.user.findUnique.mockResolvedValue(null);

      await expect(service.refreshToken(userId, refreshToken)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should delete old token before storing new one (token rotation)', async () => {
      mockJwtService.verify = jest.fn().mockReturnValue({ sub: userId });
      redis.get.mockResolvedValue(refreshToken);
      redis.del.mockResolvedValue(1);
      redis.setex.mockResolvedValue('OK');
      mockPrismaService.user.findUnique.mockResolvedValue(mockUser);
      mockJwtService.sign.mockReturnValue('token');

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

      await (service as any).generateTokens(mockUser);

      expect(jwtService.sign).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({
          expiresIn: '7d',
        }),
      );
    });

    it('should store refresh token in Redis with 7-day TTL', async () => {
      const mockUser = {
        id: 'user-id-123',
        email: 'teacher@school.edu',
        role: Role.TEACHER,
        school_id: 'school-id-123',
      };

      mockJwtService.sign.mockReturnValueOnce('access-token').mockReturnValueOnce('refresh-token');
      redis.setex.mockResolvedValue('OK');

      const result = await service.generateTokens(mockUser);

      expect(redis.setex).toHaveBeenCalledWith(
        'refresh:user-id-123',
        7 * 24 * 60 * 60,
        'refresh-token',
      );
      // Both tokens returned so controller can set cookie without a second call
      expect(result.accessToken).toBe('access-token');
      expect(result.refreshToken).toBe('refresh-token');
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

      mockPrismaService.user.findUnique.mockResolvedValueOnce(existingUser);
      mockPrismaService.user.update.mockResolvedValue({
        ...existingUser,
        last_login_at: new Date(),
      });

      const result = await service.validateGoogleUser(googleProfile);

      expect(result).toBeDefined();
      expect(result.email).toBe('teacher@example.com');
      expect(prismaService.user.findUnique).toHaveBeenCalledWith({
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
      mockPrismaService.user.findUnique
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
      mockPrismaService.user.findUnique
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

      mockPrismaService.user.findUnique.mockResolvedValueOnce(inactiveUser);
      mockPrismaService.user.update.mockResolvedValue({
        ...inactiveUser,
        last_login_at: new Date(),
      });

      await expect(service.validateGoogleUser(googleProfile)).rejects.toThrow(
        UnauthorizedException,
      );
      await expect(service.validateGoogleUser(googleProfile)).rejects.toThrow(
        'Account is inactive',
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

      mockPrismaService.user.findUnique.mockResolvedValueOnce(existingUser);
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

  describe('onModuleDestroy', () => {
    it('should quit Redis connection', async () => {
      redis.quit.mockResolvedValue('OK');

      await service.onModuleDestroy();

      expect(redis.quit).toHaveBeenCalled();
    });
  });
});
