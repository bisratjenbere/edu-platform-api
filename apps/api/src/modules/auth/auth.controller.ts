import {
  Controller,
  Post,
  Body,
  Get,
  UseGuards,
  Req,
  Res,
  HttpCode,
  HttpStatus,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { AuthService } from './auth.service';
import {
  RegisterDto,
  LoginDto,
  ForgotPasswordDto,
  ResetPasswordDto,
  OAuthExchangeDto,
} from './dto';
import { JwtAuthGuard } from './jwt-auth.guard';
import { Public } from './public.decorator';
import { GoogleAuthGuard } from './google-auth.guard';
import {
  setRefreshTokenCookie,
  clearRefreshTokenCookie,
} from './auth-cookie';
import { User } from '@prisma/client';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  @Public()
  @Post('register')
  @Throttle({ default: { limit: 5, ttl: 3600 } })
  @ApiOperation({ summary: 'Register new teacher account' })
  @ApiResponse({ status: 201, description: 'User created successfully' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 409, description: 'Email already in use' })
  async register(
    @Body() dto: RegisterDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.register(dto);
    this.setCookieFromResult(res, result.data.refreshToken);
    const { refreshToken: _, ...data } = result.data;
    return { ...result, data };
  }

  @Public()
  @Post('login')
  @Throttle({ default: { limit: 5, ttl: 900 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login with email and password' })
  @ApiResponse({ status: 200, description: 'Login successful' })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  @ApiResponse({ status: 429, description: 'Too many requests' })
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.login(dto, req.ip);
    this.setCookieFromResult(res, result.data.refreshToken);
    const { refreshToken: _, ...data } = result.data;
    return { ...result, data };
  }

  @Public()
  @Get('google')
  @UseGuards(GoogleAuthGuard)
  @ApiOperation({ summary: 'Initiate Google OAuth login' })
  @ApiResponse({ status: 302, description: 'Redirects to Google OAuth' })
  @ApiResponse({ status: 503, description: 'Google OAuth not configured' })
  googleAuth() {
    // Guard handles redirect
  }

  @Public()
  @Get('google/callback')
  @UseGuards(GoogleAuthGuard)
  @ApiOperation({ summary: 'Google OAuth callback' })
  @ApiResponse({ status: 302, description: 'Redirects to frontend with exchange code' })
  async googleAuthCallback(@Req() req: Request, @Res() res: Response) {
    const frontendUrl = this.getFrontendUrl();

    if (!req.user) {
      return res.redirect(
        `${frontendUrl}/auth/callback?error=${encodeURIComponent('Google login failed')}`,
      );
    }

    try {
      const user = req.user as User;
      const code = await this.authService.createOAuthExchangeCode(user.id);
      res.redirect(`${frontendUrl}/auth/callback?code=${code}`);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Google login failed';
      res.redirect(
        `${frontendUrl}/auth/callback?error=${encodeURIComponent(message)}`,
      );
    }
  }

  @Public()
  @Post('oauth/exchange')
  @Throttle({ default: { limit: 10, ttl: 60 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Exchange OAuth one-time code for session' })
  @ApiResponse({ status: 200, description: 'Session created successfully' })
  @ApiResponse({ status: 401, description: 'Invalid or expired code' })
  async exchangeOAuthCode(
    @Body() dto: OAuthExchangeDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.exchangeOAuthCode(dto.code);
    this.setCookieFromResult(res, result.data.refreshToken);
    const { refreshToken: _, ...data } = result.data;
    return { ...result, data };
  }

  @Public()
  @Post('refresh')
  @Throttle({ default: { limit: 30, ttl: 60 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Refresh access token using HttpOnly cookie' })
  @ApiResponse({ status: 200, description: 'Token refreshed successfully' })
  @ApiResponse({ status: 401, description: 'Invalid or expired refresh token' })
  async refreshToken(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const refreshToken = req.cookies?.__rt;

    if (!refreshToken) {
      throw new UnauthorizedException('Refresh token not found');
    }

    let userId: string;
    try {
      const verified = this.jwtService.verify(refreshToken, {
        secret: this.configService.getOrThrow<string>('JWT_REFRESH_SECRET'),
      }) as { sub: string };
      userId = verified.sub;
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const result = await this.authService.refreshToken(userId, refreshToken);
    this.setCookieFromResult(res, result.data.refreshToken);
    const { refreshToken: _, ...data } = result.data;
    return { ...result, data };
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Logout and clear refresh token cookie' })
  @ApiResponse({ status: 200, description: 'Logged out successfully' })
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    clearRefreshTokenCookie(res);

    let userId: string | undefined;

    const jwtUser = req.user as { sub?: string } | undefined;
    if (jwtUser?.sub) {
      userId = jwtUser.sub;
    } else {
      const refreshToken = req.cookies?.__rt;
      if (refreshToken) {
        userId =
          (await this.authService.resolveUserIdFromRefreshToken(
            refreshToken,
          )) ?? undefined;
      }
    }

    if (userId) {
      return this.authService.logout(userId);
    }

    return {
      success: true,
      data: { message: 'Logged out successfully' },
      error: null,
    };
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current authenticated user' })
  @ApiResponse({ status: 200, description: 'User profile returned' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getMe(@Req() req: Request) {
    const user = req.user as { sub: string };
    const profile = await this.authService.getProfile(user.sub);
    return {
      success: true,
      data: { user: profile },
      error: null,
    };
  }

  @Public()
  @Post('forgot-password')
  @Throttle({ default: { limit: 5, ttl: 3600 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Request a password reset code' })
  @ApiResponse({ status: 200, description: 'Reset code issued if account exists' })
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto);
  }

  @Public()
  @Post('reset-password')
  @Throttle({ default: { limit: 5, ttl: 3600 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reset password using email and reset code' })
  @ApiResponse({ status: 200, description: 'Password reset successfully' })
  @ApiResponse({ status: 401, description: 'Invalid or expired reset code' })
  async resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto);
  }

  private setCookieFromResult(res: Response, refreshToken: string): void {
    setRefreshTokenCookie(res, refreshToken);
  }

  private getFrontendUrl(): string {
    return this.configService.get<string>('FRONTEND_URL') || 'http://localhost:3000';
  }
}
