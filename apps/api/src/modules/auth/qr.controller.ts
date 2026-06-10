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
    const user = req.user as any;
    const teacherId = user?.sub;

    return this.qrService.generateQr(teacherId, studentId);
  }

  @Post('qr-login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login using QR code token' })
  @ApiResponse({ status: 200, description: 'Login successful' })
  @ApiResponse({ status: 401, description: 'Invalid or expired QR code' })
  async qrLogin(
    @Body() dto: QrLoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    // Validate QR token and get student user
    const student = await this.qrService.validateQr(dto.token);

    // Generate JWT tokens
    const tokens = await this.authService.generateTokens(student);

    // Set refresh token as HttpOnly cookie
    res.cookie('__rt', tokens.refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });

    // Return access token and user info
    return {
      success: true,
      data: {
        user: {
          id: student.id,
          email: student.email,
          role: student.role,
          schoolId: student.school_id,
        },
        accessToken: tokens.accessToken,
      },
      error: null,
    };
  }
}
