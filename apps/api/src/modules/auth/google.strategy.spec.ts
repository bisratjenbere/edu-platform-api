import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { GoogleStrategy } from './google.strategy';
import { AuthService } from './auth.service';
import { UnauthorizedException } from '@nestjs/common';
import { Profile } from 'passport-google-oauth20';

describe('GoogleStrategy', () => {
  let strategy: GoogleStrategy;

  const mockAuthService = {
    validateGoogleUser: jest.fn(),
  };

  const mockConfigService = {
    get: jest.fn((key: string) => {
      const config: Record<string, string> = {
        GOOGLE_CALLBACK_URL: 'http://localhost:3001/api/v1/auth/google/callback',
      };
      return config[key];
    }),
    getOrThrow: jest.fn((key: string) => {
      const config: Record<string, string> = {
        GOOGLE_CLIENT_ID: 'test-client-id',
        GOOGLE_CLIENT_SECRET: 'test-client-secret',
      };
      if (config[key]) return config[key];
      throw new Error(`Missing ${key}`);
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GoogleStrategy,
        {
          provide: AuthService,
          useValue: mockAuthService,
        },
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    strategy = module.get<GoogleStrategy>(GoogleStrategy);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(strategy).toBeDefined();
  });

  describe('validate', () => {
    const mockProfile: Partial<Profile> = {
      id: 'google-123',
      emails: [{ value: 'teacher@example.com', verified: true }],
      name: {
        givenName: 'John',
        familyName: 'Doe',
      },
      photos: [{ value: 'https://example.com/photo.jpg' }],
    };

    const mockUser = {
      id: 'user-123',
      email: 'teacher@example.com',
      role: 'TEACHER',
      google_id: 'google-123',
      is_active: true,
    };

    it('should validate user with valid Google profile', async () => {
      mockAuthService.validateGoogleUser.mockResolvedValue(mockUser);

      const done = jest.fn();
      await strategy.validate(
        'access-token',
        'refresh-token',
        mockProfile as Profile,
        done,
      );

      expect(mockAuthService.validateGoogleUser).toHaveBeenCalledWith({
        googleId: 'google-123',
        email: 'teacher@example.com',
        firstName: 'John',
        lastName: 'Doe',
        profilePhoto: 'https://example.com/photo.jpg',
      });
      expect(done).toHaveBeenCalledWith(null, mockUser);
    });

    it('should return error when no verified email in profile', async () => {
      const profileWithoutEmail: Partial<Profile> = {
        id: 'google-123',
        emails: [],
        name: {
          givenName: 'John',
          familyName: 'Doe',
        },
      };

      const done = jest.fn();
      await strategy.validate(
        'access-token',
        'refresh-token',
        profileWithoutEmail as Profile,
        done,
      );

      expect(mockAuthService.validateGoogleUser).not.toHaveBeenCalled();
      expect(done).toHaveBeenCalledWith(expect.any(Error), false);
      expect(done.mock.calls[0][0].message).toBe('Email not verified by Google');
    });

    it('should return error when email is not verified', async () => {
      const profileUnverified: Partial<Profile> = {
        id: 'google-123',
        emails: [{ value: 'teacher@example.com', verified: false }],
      };

      const done = jest.fn();
      await strategy.validate(
        'access-token',
        'refresh-token',
        profileUnverified as Profile,
        done,
      );

      expect(mockAuthService.validateGoogleUser).not.toHaveBeenCalled();
      expect(done).toHaveBeenCalledWith(expect.any(Error), false);
    });

    it('should handle validateGoogleUser errors', async () => {
      const error = new UnauthorizedException('Account is inactive');
      mockAuthService.validateGoogleUser.mockRejectedValue(error);

      const done = jest.fn();
      await strategy.validate(
        'access-token',
        'refresh-token',
        mockProfile as Profile,
        done,
      );

      expect(mockAuthService.validateGoogleUser).toHaveBeenCalled();
      expect(done).toHaveBeenCalledWith(error, false);
    });

    it('should handle profile without name fields', async () => {
      const profileWithoutName: Partial<Profile> = {
        id: 'google-456',
        emails: [{ value: 'test@example.com', verified: true }],
      };

      mockAuthService.validateGoogleUser.mockResolvedValue({
        ...mockUser,
        email: 'test@example.com',
        google_id: 'google-456',
      });

      const done = jest.fn();
      await strategy.validate(
        'access-token',
        'refresh-token',
        profileWithoutName as Profile,
        done,
      );

      expect(mockAuthService.validateGoogleUser).toHaveBeenCalledWith({
        googleId: 'google-456',
        email: 'test@example.com',
        firstName: undefined,
        lastName: undefined,
        profilePhoto: undefined,
      });
      expect(done).toHaveBeenCalledWith(null, expect.any(Object));
    });
  });
});
