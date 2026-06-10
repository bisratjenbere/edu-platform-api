import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { JwtAuthGuard } from './jwt-auth.guard';

describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [JwtAuthGuard],
    }).compile();

    guard = module.get<JwtAuthGuard>(JwtAuthGuard);
  });

  it('should be defined', () => {
    expect(guard).toBeDefined();
  });

  describe('handleRequest', () => {
    it('should return user when authentication succeeds', () => {
      const mockUser = {
        sub: 'user-id-123',
        email: 'test@example.com',
        role: 'TEACHER',
      };

      const result = guard.handleRequest(null, mockUser, null);

      expect(result).toEqual(mockUser);
    });

    it('should throw UnauthorizedException when user is not provided', () => {
      expect(() => guard.handleRequest(null, null, null)).toThrow(
        UnauthorizedException,
      );
      expect(() => guard.handleRequest(null, null, null)).toThrow(
        'Invalid or expired token',
      );
    });

    it('should throw UnauthorizedException when error is provided', () => {
      const error = new Error('Token expired');

      expect(() => guard.handleRequest(error, null, null)).toThrow(error);
    });

    it('should throw the provided error instead of generic error', () => {
      const customError = new UnauthorizedException('Custom auth error');

      expect(() => guard.handleRequest(customError, null, null)).toThrow(
        customError,
      );
    });

    it('should return user even when info is provided', () => {
      const mockUser = {
        sub: 'user-id-123',
        email: 'test@example.com',
        role: 'TEACHER',
      };
      const info = { message: 'Some info' };

      const result = guard.handleRequest(null, mockUser, info);

      expect(result).toEqual(mockUser);
    });
  });
});
