import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import * as QRCode from 'qrcode';
import { Role } from '@prisma/client';
import { RedisService } from '../../redis/redis.service';
import { createHash } from 'crypto';

interface QrPayload {
  studentId: string;
  classId: string;
  type: 'QR_LOGIN';
  iat: number;
  exp: number;
}

@Injectable()
export class QrService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private configService: ConfigService,
    private redis: RedisService,
  ) {}

  /**
   * Generate QR code for student login
   * Teacher must be authorized to generate QR for this student
   */
  async generateQr(teacherId: string, studentId: string) {
    // Verify student exists and is active
    const student = await this.prisma.user.findUnique({
      where: {
        id: studentId,
        deleted_at: null,
      },
    });

    if (!student) {
      throw new BadRequestException('Student not found');
    }

    if (student.role !== Role.STUDENT) {
      throw new BadRequestException('User is not a student');
    }

    if (!student.is_active) {
      throw new BadRequestException('Student account is inactive');
    }

    // Verify teacher has access to this student (they share a class)
    const sharedClass = await this.prisma.classStudent.findFirst({
      where: {
        student_id: studentId,
        is_active: true,
        class: {
          teachers: {
            some: {
              teacher_id: teacherId,
            },
          },
          deleted_at: null,
        },
      },
      include: {
        class: true,
      },
    });

    if (!sharedClass) {
      throw new ForbiddenException('Teacher does not have access to this student');
    }

    // Generate QR token with 60-second expiry
    const payload: QrPayload = {
      studentId: student.id,
      classId: sharedClass.class_id,
      type: 'QR_LOGIN',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 60, // 60 seconds
    };

    const token = this.jwtService.sign(payload, {
      secret: this.configService.getOrThrow<string>('JWT_QR_SECRET'),
      expiresIn: '60s',
    });

    // Generate QR code image as data URL
    const qrDataUrl = await QRCode.toDataURL(token, {
      errorCorrectionLevel: 'M',
      width: 300,
      margin: 2,
    });

    return {
      success: true,
      data: {
        qrCodeDataUrl: qrDataUrl,
        expiresIn: 60,
        studentId: student.id,
        studentEmail: student.email,
      },
      error: null,
    };
  }

  /**
   * Validate QR token and log in student
   * Token is single-use and expires after 60 seconds
   * 
   * Sequence (non-negotiable per design.md):
   * 1. Validate JWT signature and expiry
   * 2. Check Redis: if used_qr:{token} exists → return 401
   * 3. Set used_qr:{token} = "1" with TTL 60s BEFORE issuing session
   * 4. Issue student session
   */
  async validateQr(token: string) {
    // Step 1: Validate JWT signature and expiry FIRST
    let payload: QrPayload;
    try {
      payload = this.jwtService.verify(token, {
        secret: this.configService.getOrThrow<string>('JWT_QR_SECRET'),
      }) as QrPayload;
    } catch (error) {
      throw new UnauthorizedException('Invalid or expired QR code');
    }

    // Verify payload type
    if (payload.type !== 'QR_LOGIN') {
      throw new UnauthorizedException('Invalid QR code type');
    }

    // Step 2 + 3 (atomic): Mark token as used with SET NX BEFORE issuing session.
    // SET NX is atomic — only one concurrent caller can win. This eliminates the
    // check-then-set race condition that existed with separate GET + SETEX calls.
    // Use sha256 of the token as the key to avoid storing full JWTs (200-400 bytes)
    // as Redis keys at high scan volume.
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const claimed = await this.redis.setNx(
      `used_qr:${tokenHash}`,
      '1',
      RedisService.TTL.QR_TOKEN_SECONDS,
    );
    if (!claimed) {
      throw new UnauthorizedException('QR code has already been used');
    }

    // Step 4: Get student user and issue session
    const student = await this.prisma.user.findUnique({
      where: {
        id: payload.studentId,
        deleted_at: null,
      },
    });

    if (!student || !student.is_active) {
      throw new UnauthorizedException('Student not found or inactive');
    }

    if (student.role !== Role.STUDENT) {
      throw new UnauthorizedException('User is not a student');
    }

    // Update last_login_at
    await this.prisma.user.update({
      where: { id: student.id },
      data: { last_login_at: new Date() },
    });

    return student;
  }

}