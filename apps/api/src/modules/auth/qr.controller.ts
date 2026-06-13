import {
  Controller,
  Post,
  Body,
  Param,
  UseGuards,
  Req,
  Res,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
} from '@nestjs/swagger';
import { QrService } from './qr.service';
import { AuthService } from './auth.service';
import { QrLoginDto } from './dto';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RolesGuard } from './roles.guard';
import { Roles } from './roles.decorator';
import { Role } from '@prisma/client';
import { setRefreshTokenCookie } from './auth-cookie';
import { Public } from './public.decorator';

@ApiTags('auth')
@Controller('auth')
export class QrController {
  constructor(
    private readonly qrService: QrService,
    private readonly authService: AuthService,
  ) {}

  @Post('student-qr/:studentId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.TEACHER)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Generate QR code for student login' })
  @ApiParam({ name: 'studentId', description: 'Student user ID' })
  @ApiResponse({ status: 201, description: 'QR code generated successfully' })
  @ApiResponse({ status: 400, description: 'Student not found or invalid' })
  @ApiResponse({ status: 403, description: 'Teacher does not have access to this student' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async generateStudentQr(
    @Param('studentId') studentId: string,
    @Req() req: Request,
  ) {
    const user = req.user as { sub: string };
    return this.qrService.generateQr(user.sub, studentId);
  }

  @Public()
  @Post('qr-login')
  @Throttle({ default: { limit: 10, ttl: 60 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login using QR code token' })
  @ApiResponse({ status: 200, description: 'Login successful' })
  @ApiResponse({ status: 401, description: 'Invalid or expired QR code' })
  async qrLogin(
    @Body() dto: QrLoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const student = await this.qrService.validateQr(dto.token);
    const session = await this.authService.createSessionForUser(student);

    setRefreshTokenCookie(res, session.refreshToken);

    return {
      success: true,
      data: {
        user: session.user,
        accessToken: session.accessToken,
      },
      error: null,
    };
  }
}
