import {
  Injectable,
  ConflictException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { RegisterDto, LoginDto } from './dto';
import * as bcrypt from 'bcrypt';
import { Redis } from 'ioredis';
import { Role } from '@prisma/client';
import { JwtPayload } from '../../common/types/jwt-payload.interface';

@Injectable()
export class AuthService {
  private redis: Redis;

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private configService: ConfigService,
  ) {
    // Initialize Redis client
    const redisUrl = this.configService.get<string>('REDIS_URL') || 'redis://localhost:6379';
    this.redis = new Redis(redisUrl);
  }

  async register(dto: RegisterDto) {
    // Check if user already exists
    const existingUser = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (existingUser) {
      throw new ConflictException('Email already in use');
    }

    // Hash password with bcrypt (12 salt rounds per security spec)
    const passwordHash = await bcrypt.hash(dto.password, 12);

    // Create user with TEACHER role by default (as per requirement US-AUTH-01)
    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        password_hash: passwordHash,
        first_name: dto.firstName,
        last_name: dto.lastName,
        role: Role.TEACHER,
        is_active: true,
      },
    });

    // Update last_login_at
    await this.prisma.user.update({
      where: { id: user.id },
      data: { last_login_at: new Date() },
    });

    // Generate tokens
    const tokens = await this.generateTokens(user);

    // Return user data without password_hash
    return {
      success: true,
      data: {
        user: {
          id: user.id,
          email: user.email,
          role: user.role,
          schoolId: user.school_id,
        },
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
      },
      error: null,
    };
  }

  async login(dto: LoginDto, ipAddress?: string) {
    // Rate limiting check (5 attempts per 15 minutes per IP)
    if (ipAddress) {
      const attemptsKey = `login_attempts:${ipAddress}`;
      const attempts = await this.redis.get(attemptsKey);
      
      if (attempts && parseInt(attempts) >= 5) {
        throw new UnauthorizedException('Too many failed login attempts. Try again later.');
      }
    }

    // Find user by email
    const user = await this.prisma.user.findUnique({
      where: { 
        email: dto.email,
        deleted_at: null,
      },
    });

    if (!user || !user.password_hash) {
      // Increment failed attempts
      if (ipAddress) {
        const attemptsKey = `login_attempts:${ipAddress}`;
        await this.redis.incr(attemptsKey);
        await this.redis.expire(attemptsKey, 900); // 15 minutes
      }
      throw new UnauthorizedException('Invalid credentials');
    }

    // Check if user is active
    if (!user.is_active) {
      throw new UnauthorizedException('Account is inactive');
    }

    // Verify password
    const isPasswordValid = await bcrypt.compare(dto.password, user.password_hash);

    if (!isPasswordValid) {
      // Increment failed attempts
      if (ipAddress) {
        const attemptsKey = `login_attempts:${ipAddress}`;
        await this.redis.incr(attemptsKey);
        await this.redis.expire(attemptsKey, 900); // 15 minutes
      }
      throw new UnauthorizedException('Invalid credentials');
    }

    // Clear attempts on successful login
    if (ipAddress) {
      await this.redis.del(`login_attempts:${ipAddress}`);
    }

    // Update last_login_at
    await this.prisma.user.update({
      where: { id: user.id },
      data: { last_login_at: new Date() },
    });

    // Generate tokens
    const tokens = await this.generateTokens(user);

    // Return user data without password_hash
    // refreshToken is returned so the controller can set the HttpOnly cookie
    return {
      success: true,
      data: {
        user: {
          id: user.id,
          email: user.email,
          role: user.role,
          schoolId: user.school_id,
        },
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
      },
      error: null,
    };
  }

  async refreshToken(userId: string, refreshToken: string) {
    // Verify JWT signature first
    try {
      this.jwtService.verify(refreshToken, {
        secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
      });
    } catch (error) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    // Get stored refresh token from Redis
    const storedToken = await this.redis.get(`refresh:${userId}`);

    if (!storedToken || storedToken !== refreshToken) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    // Get user to generate new tokens
    const user = await this.prisma.user.findUnique({
      where: { 
        id: userId,
        deleted_at: null,
      },
    });

    if (!user || !user.is_active) {
      throw new UnauthorizedException('User not found or inactive');
    }

    // Invalidate old refresh token (token rotation)
    await this.redis.del(`refresh:${userId}`);

    // Generate new token pair
    const tokens = await this.generateTokens(user);

    return {
      success: true,
      data: {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
      },
      error: null,
    };
  }

  async logout(userId: string) {
    // Delete refresh token from Redis
    await this.redis.del(`refresh:${userId}`);

    return {
      success: true,
      data: {
        message: 'Logged out successfully',
      },
      error: null,
    };
  }

  /**
   * Generate access and refresh tokens for a user.
   * Private — only called internally. Controllers must not call this directly.
   * Returns both tokens so callers can set the cookie without a second DB/Redis round-trip.
   */
  async generateTokens(user: { id: string; email: string; role: Role; school_id: string | null }) {
    const payload: Omit<JwtPayload, 'iat' | 'exp'> = {
      sub: user.id,
      email: user.email,
      role: user.role,
      schoolId: user.school_id,
    };

    // Generate access token (15 minutes expiry)
    const accessToken = this.jwtService.sign(payload, {
      secret: this.configService.get<string>('JWT_SECRET'),
      expiresIn: '15m',
    });

    // Generate refresh token (7 days expiry)
    const refreshTokenSecret = this.configService.get<string>('JWT_REFRESH_SECRET');
    const refreshToken = this.jwtService.sign(payload, {
      secret: refreshTokenSecret,
      expiresIn: '7d',
    });

    // Store refresh token in Redis with 7-day TTL (store directly, not hashed)
    await this.redis.setex(
      `refresh:${user.id}`,
      7 * 24 * 60 * 60, // 7 days in seconds
      refreshToken,
    );

    return {
      accessToken,
      refreshToken,
    };
  }

  /**
   * Validate and upsert user from Google OAuth profile
   * Per US-AUTH-03: if Google email matches existing account, log in
   * If no account exists, create one with role TEACHER
   */
  async validateGoogleUser(profile: {
    googleId: string;
    email: string;
    firstName?: string;
    lastName?: string;
    profilePhoto?: string;
  }) {
    // First, try to find user by google_id
    let user = await this.prisma.user.findUnique({
      where: { 
        google_id: profile.googleId,
        deleted_at: null,
      },
    });

    // If not found by google_id, try to find by email
    if (!user) {
      user = await this.prisma.user.findUnique({
        where: { 
          email: profile.email,
          deleted_at: null,
        },
      });

      // If found by email, link the google_id
      if (user) {
        user = await this.prisma.user.update({
          where: { id: user.id },
          data: { 
            google_id: profile.googleId,
            last_login_at: new Date(),
          },
        });
      }
    }

    // If still no user found, create new account with TEACHER role
    if (!user) {
      user = await this.prisma.user.create({
        data: {
          email: profile.email,
          google_id: profile.googleId,
          first_name: profile.firstName || '',
          last_name: profile.lastName || '',
          role: Role.TEACHER,
          is_active: true,
          last_login_at: new Date(),
        },
      });
    } else {
      // Update last_login_at for existing user
      user = await this.prisma.user.update({
        where: { id: user.id },
        data: { last_login_at: new Date() },
      });
    }

    // Check if user is active
    if (!user.is_active) {
      throw new UnauthorizedException('Account is inactive');
    }

    return user;
  }

  /**
   * Cleanup method for graceful shutdown
   */
  async onModuleDestroy() {
    await this.redis.quit();
  }
}

