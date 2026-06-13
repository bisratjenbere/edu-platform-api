import {
  Injectable,
  ConflictException,
  UnauthorizedException,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { RegisterDto, LoginDto, ForgotPasswordDto, ResetPasswordDto } from './dto';
import * as bcrypt from 'bcrypt';
import { Role, User } from '@prisma/client';
import { JwtPayload } from '../../common/types/jwt-payload.interface';
import { RedisService } from '../../redis/redis.service';
import { MailService } from './mail.service';
import { randomBytes, createHash } from 'crypto';

@Injectable()
export class AuthService implements OnModuleInit {
  private readonly logger = new Logger(AuthService.name);

  private static readonly REQUIRED_SECRETS = [
    'JWT_SECRET',
    'JWT_REFRESH_SECRET',
    'JWT_QR_SECRET',
  ] as const;

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private configService: ConfigService,
    private redis: RedisService,
    private mail: MailService,
  ) {}

  onModuleInit(): void {
    for (const key of AuthService.REQUIRED_SECRETS) {
      this.configService.getOrThrow<string>(key);
    }
  }

  async register(dto: RegisterDto) {
    const requiredCode = this.configService.get<string>('TEACHER_REGISTRATION_CODE');
    if (requiredCode && dto.registrationCode !== requiredCode) {
      throw new UnauthorizedException('Invalid registration code');
    }

    const existingUser = await this.prisma.user.findFirst({
      where: { email: dto.email, deleted_at: null },
    });

    if (existingUser) {
      throw new ConflictException('Email already in use');
    }

    const passwordHash = await bcrypt.hash(dto.password, 12);

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

    await this.prisma.user.update({
      where: { id: user.id },
      data: { last_login_at: new Date() },
    });

    const tokens = await this.generateTokens(user);

    return {
      success: true,
      data: {
        user: this.formatUser(user),
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
      },
      error: null,
    };
  }

  async login(dto: LoginDto, ipAddress?: string) {
    if (ipAddress) {
      await this.assertLoginAttemptsAllowed(ipAddress);
    }

    const user = await this.prisma.user.findFirst({
      where: {
        email: dto.email,
        deleted_at: null,
      },
    });

    if (!user || !user.password_hash) {
      if (ipAddress) {
        await this.recordFailedLoginAttempt(ipAddress);
      }
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!user.is_active) {
      if (ipAddress) {
        await this.recordFailedLoginAttempt(ipAddress);
      }
      throw new UnauthorizedException('Invalid credentials');
    }

    const isPasswordValid = await bcrypt.compare(dto.password, user.password_hash);

    if (!isPasswordValid) {
      if (ipAddress) {
        await this.recordFailedLoginAttempt(ipAddress);
      }
      throw new UnauthorizedException('Invalid credentials');
    }

    if (ipAddress) {
      await this.redis.del(`login_attempts:${ipAddress}`);
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { last_login_at: new Date() },
    });

    const tokens = await this.generateTokens(user);

    return {
      success: true,
      data: {
        user: this.formatUser(user),
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
      },
      error: null,
    };
  }

  async refreshToken(userId: string, refreshToken: string) {
    try {
      this.jwtService.verify(refreshToken, {
        secret: this.configService.getOrThrow<string>('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const storedHash = await this.redis.get(`refresh:${userId}`);

    if (!storedHash || !(await bcrypt.compare(refreshToken, storedHash))) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const user = await this.prisma.user.findFirst({
      where: {
        id: userId,
        deleted_at: null,
      },
    });

    if (!user || !user.is_active) {
      throw new UnauthorizedException('User not found or inactive');
    }

    await this.redis.del(`refresh:${userId}`);

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
    await this.redis.del(`refresh:${userId}`);

    return {
      success: true,
      data: {
        message: 'Logged out successfully',
      },
      error: null,
    };
  }

  async getProfile(userId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deleted_at: null },
      select: {
        id: true,
        email: true,
        role: true,
        school_id: true,
        first_name: true,
        last_name: true,
        preferred_language: true,
        last_login_at: true,
      },
    });

    if (!user) {
      throw new UnauthorizedException('User not found or inactive');
    }

    return {
      id: user.id,
      email: user.email,
      role: user.role,
      schoolId: user.school_id,
      firstName: user.first_name,
      lastName: user.last_name,
      preferredLanguage: user.preferred_language,
      lastLoginAt: user.last_login_at,
    };
  }

  /**
   * Create a one-time code for OAuth / magic-link completion (avoids tokens in redirect URLs).
   */
  async createOAuthExchangeCode(userId: string): Promise<string> {
    const code = randomBytes(32).toString('hex');
    await this.redis.setex(
      `oauth_code:${code}`,
      RedisService.TTL.OAUTH_CODE_SECONDS,
      userId,
    );
    return code;
  }

  async exchangeOAuthCode(code: string) {
    const userId = await this.redis.get(`oauth_code:${code}`);
    if (!userId) {
      throw new UnauthorizedException('Invalid or expired login code');
    }

    await this.redis.del(`oauth_code:${code}`);

    const user = await this.prisma.user.findFirst({
      where: { id: userId, deleted_at: null },
    });

    if (!user || !user.is_active) {
      throw new UnauthorizedException('User not found or inactive');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { last_login_at: new Date() },
    });

    const tokens = await this.generateTokens(user);

    return {
      success: true,
      data: {
        user: this.formatUser(user),
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
      },
      error: null,
    };
  }

  async createSessionForUser(user: User) {
    const tokens = await this.generateTokens(user);

    return {
      user: this.formatUser(user),
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    };
  }

  async forgotPassword(dto: ForgotPasswordDto) {
    const user = await this.prisma.user.findFirst({
      where: { email: dto.email, deleted_at: null },
    });

    if (user?.password_hash) {
      const code = randomBytes(3).toString('hex').toUpperCase();
      const codeHash = createHash('sha256').update(code).digest('hex');
      await this.redis.setex(
        `password_reset:${codeHash}`,
        RedisService.TTL.PASSWORD_RESET_SECONDS,
        user.id,
      );

      try {
        await this.mail.sendPasswordResetEmail(dto.email, code);
      } catch (error) {
        this.logger.error(
          `Failed to send password reset email to ${dto.email}`,
          error instanceof Error ? error.stack : error,
        );
      }
    }

    return {
      success: true,
      data: {
        message:
          'If an account exists with this email, a reset code has been sent.',
      },
      error: null,
    };
  }

  async resetPassword(dto: ResetPasswordDto) {
    const codeHash = createHash('sha256').update(dto.code).digest('hex');
    const userId = await this.redis.get(`password_reset:${codeHash}`);

    if (!userId) {
      throw new UnauthorizedException('Invalid or expired reset code');
    }

    const user = await this.prisma.user.findFirst({
      where: { id: userId, email: dto.email, deleted_at: null },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid or expired reset code');
    }

    const passwordHash = await bcrypt.hash(dto.password, 12);

    await this.prisma.user.update({
      where: { id: user.id },
      data: { password_hash: passwordHash },
    });

    await this.redis.del(`password_reset:${codeHash}`);
    await this.redis.del(`refresh:${user.id}`);

    return {
      success: true,
      data: { message: 'Password reset successfully' },
      error: null,
    };
  }

  async resolveUserIdFromRefreshToken(refreshToken: string): Promise<string | null> {
    try {
      const verified = this.jwtService.verify(refreshToken, {
        secret: this.configService.getOrThrow<string>('JWT_REFRESH_SECRET'),
      }) as { sub: string };
      return verified.sub;
    } catch {
      return null;
    }
  }

  private async assertLoginAttemptsAllowed(ipAddress: string): Promise<void> {
    const attemptsKey = `login_attempts:${ipAddress}`;
    const attempts = await this.redis.get(attemptsKey);

    if (attempts && parseInt(attempts, 10) >= 5) {
      throw new UnauthorizedException(
        'Too many failed login attempts. Try again later.',
      );
    }
  }

  private async recordFailedLoginAttempt(ipAddress: string): Promise<void> {
    const attemptsKey = `login_attempts:${ipAddress}`;
    const attempts = await this.redis.incr(attemptsKey);
    if (attempts === 1) {
      await this.redis.expire(
        attemptsKey,
        RedisService.TTL.LOGIN_WINDOW_SECONDS,
      );
    }
  }

  private formatUser(user: {
    id: string;
    email: string;
    role: Role;
    school_id: string | null;
  }) {
    return {
      id: user.id,
      email: user.email,
      role: user.role,
      schoolId: user.school_id,
    };
  }

  private async generateTokens(user: {
    id: string;
    email: string;
    role: Role;
    school_id: string | null;
  }) {
    const payload: Omit<JwtPayload, 'iat' | 'exp'> = {
      sub: user.id,
      email: user.email,
      role: user.role,
      schoolId: user.school_id,
    };

    const accessToken = this.jwtService.sign(payload, {
      secret: this.configService.getOrThrow<string>('JWT_SECRET'),
      expiresIn: '15m',
    });

    const refreshTokenSecret = this.configService.getOrThrow<string>(
      'JWT_REFRESH_SECRET',
    );
    const refreshToken = this.jwtService.sign(payload, {
      secret: refreshTokenSecret,
      expiresIn: '7d',
    });

    const refreshTokenHash = await bcrypt.hash(refreshToken, 10);
    await this.redis.setex(
      `refresh:${user.id}`,
      RedisService.TTL.REFRESH_TOKEN_SECONDS,
      refreshTokenHash,
    );

    return {
      accessToken,
      refreshToken,
    };
  }

  async validateGoogleUser(profile: {
    googleId: string;
    email: string;
    firstName?: string;
    lastName?: string;
    profilePhoto?: string;
  }) {
    let user = await this.prisma.user.findFirst({
      where: {
        google_id: profile.googleId,
        deleted_at: null,
      },
    });

    if (!user) {
      user = await this.prisma.user.findFirst({
        where: {
          email: profile.email,
          deleted_at: null,
        },
      });

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
      user = await this.prisma.user.update({
        where: { id: user.id },
        data: { last_login_at: new Date() },
      });
    }

    if (!user.is_active) {
      throw new UnauthorizedException('Authentication failed');
    }

    return user;
  }
}
