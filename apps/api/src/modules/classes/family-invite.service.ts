import {
  Injectable,
  NotFoundException,
  UnauthorizedException,
  ConflictException,
  BadRequestException,
  Inject,
  forwardRef,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { createHash } from 'crypto';
import { Role, FamilyStudentStatus, NotificationType, User } from '@prisma/client';
import { NotificationsService } from '../notifications/notifications.service';
import { MailService } from '../auth/mail.service';

interface FamilyInvitePayload {
  familyStudentId: string;
  email: string;
  classId: string;
  type: 'FAMILY_INVITE';
}

export interface FamilyInviteAcceptResult {
  user: User;
  connection: {
    student_name: string;
    class_name: string;
  };
  alreadyAccepted: boolean;
}

@Injectable()
export class FamilyInviteService {
  private readonly logger = new Logger(FamilyInviteService.name);

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private configService: ConfigService,
    private redis: RedisService,
    private mail: MailService,
    @Inject(forwardRef(() => NotificationsService))
    private readonly notificationsService: NotificationsService,
  ) {}

  /**
   * Create a family invite for a student in a class
   */
  async invite(classId: string, teacherId: string, email: string, studentId: string) {
    // Verify teacher access to class
    const classTeacher = await this.prisma.classTeacher.findUnique({
      where: {
        class_id_teacher_id: {
          class_id: classId,
          teacher_id: teacherId,
        },
      },
    });

    if (!classTeacher) {
      throw new NotFoundException('Class not found or access denied');
    }

    // Verify student is in the class
    const classStudent = await this.prisma.classStudent.findUnique({
      where: {
        class_id_student_id: {
          class_id: classId,
          student_id: studentId,
        },
      },
    });

    if (!classStudent || !classStudent.is_active) {
      throw new NotFoundException('Student not found in this class');
    }

    // Find or create family user
    let familyUser = await this.prisma.user.findUnique({
      where: {
        email,
        deleted_at: null,
      },
    });

    if (!familyUser) {
      // Create new family user account
      familyUser = await this.prisma.user.create({
        data: {
          email,
          role: Role.FAMILY,
          is_active: true,
        },
      });
    } else if (familyUser.role !== Role.FAMILY) {
      throw new BadRequestException('User with this email exists but is not a family member');
    }

    // Check if already connected
    const existing = await this.prisma.familyStudent.findUnique({
      where: {
        family_id_student_id_class_id: {
          family_id: familyUser.id,
          student_id: studentId,
          class_id: classId,
        },
      },
    });

    if (existing && existing.status === FamilyStudentStatus.ACTIVE) {
      throw new ConflictException('Family member is already connected to this student');
    }

    // Create or update FamilyStudent record
    const familyStudent = await this.prisma.familyStudent.upsert({
      where: {
        family_id_student_id_class_id: {
          family_id: familyUser.id,
          student_id: studentId,
          class_id: classId,
        },
      },
      create: {
        family_id: familyUser.id,
        student_id: studentId,
        class_id: classId,
        status: FamilyStudentStatus.PENDING,
        invited_by: teacherId,
      },
      update: {
        status: FamilyStudentStatus.PENDING,
        invited_by: teacherId,
        invited_at: new Date(),
        deleted_at: null,
      },
    });

    // Generate invite JWT (7-day expiry)
    const payload: FamilyInvitePayload = {
      familyStudentId: familyStudent.id,
      email: familyUser.email,
      classId,
      type: 'FAMILY_INVITE',
    };

    const token = this.jwtService.sign(payload, {
      secret: this.configService.get<string>('JWT_SECRET'),
      expiresIn: '7d',
    });

    // Hash token and store in Redis (7-day TTL)
    const tokenHash = this.hashToken(token);
    await this.redis.setex(
      `family_invite:${tokenHash}`,
      7 * 24 * 60 * 60, // 7 days in seconds
      '1',
    );

    // Get student details for email
    const student = await this.prisma.user.findUnique({
      where: { id: studentId },
      select: { first_name: true, last_name: true },
    });

    const classRecord = await this.prisma.class.findUnique({
      where: { id: classId },
      select: { name: true },
    });

    const apiUrl =
      this.configService.get<string>('APP_URL') || 'http://localhost:3001';
    const acceptUrl = `${apiUrl}/api/v1/classes/family-invites/accept?token=${token}`;

    try {
      await this.mail.sendFamilyInviteEmail(familyUser.email, acceptUrl, {
        studentName: `${student?.first_name ?? ''} ${student?.last_name ?? ''}`.trim(),
        className: classRecord?.name ?? 'your class',
      });
    } catch (error) {
      this.logger.error(
        `Failed to send family invite email to ${familyUser.email}`,
        error instanceof Error ? error.stack : error,
      );
    }

    const invite: Record<string, string> = {
      email: familyUser.email,
      student_name: `${student?.first_name} ${student?.last_name}`,
      class_name: classRecord?.name ?? '',
    };

    if (process.env.NODE_ENV !== 'production') {
      invite.accept_url = acceptUrl;
    }

    return {
      success: true,
      data: {
        message: 'Family invite sent successfully',
        invite,
      },
      error: null,
    };
  }

  /**
   * Accept a family invite
   */
  async acceptInvite(token: string): Promise<FamilyInviteAcceptResult> {
    // Verify JWT
    let payload: FamilyInvitePayload;
    try {
      payload = this.jwtService.verify(token, {
        secret: this.configService.get<string>('JWT_SECRET'),
      });
    } catch (error) {
      throw new UnauthorizedException('Invalid or expired invite token');
    }

    if (payload.type !== 'FAMILY_INVITE') {
      throw new UnauthorizedException('Invalid token type');
    }

    const tokenHash = this.hashToken(token);

    // Load FamilyStudent record
    const familyStudent = await this.prisma.familyStudent.findUnique({
      where: {
        id: payload.familyStudentId,
      },
      include: {
        student: {
          select: {
            id: true,
            first_name: true,
            last_name: true,
          },
        },
        class: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    if (!familyStudent) {
      throw new NotFoundException('Invite not found');
    }

    if (familyStudent.deleted_at) {
      throw new UnauthorizedException('Invite has been revoked');
    }

    if (familyStudent.status === FamilyStudentStatus.REVOKED) {
      throw new UnauthorizedException('Invite has been revoked');
    }

    const connection = {
      student_name: `${familyStudent.student.first_name} ${familyStudent.student.last_name}`,
      class_name: familyStudent.class.name,
    };

    const familyUser = await this.prisma.user.findFirst({
      where: { id: familyStudent.family_id, deleted_at: null },
    });

    if (!familyUser || !familyUser.is_active) {
      throw new UnauthorizedException('Family account not found or inactive');
    }

    if (familyStudent.status === FamilyStudentStatus.ACTIVE) {
      return {
        user: familyUser,
        connection,
        alreadyAccepted: true,
      };
    }

    // Atomically claim the invite before activating (prevents concurrent double-accept)
    const claimed = await this.redis.del(`family_invite:${tokenHash}`);
    if (!claimed) {
      throw new UnauthorizedException('Invite has been revoked or already used');
    }

    // Activate the connection
    await this.prisma.familyStudent.update({
      where: {
        id: familyStudent.id,
      },
      data: {
        status: FamilyStudentStatus.ACTIVE,
        accepted_at: new Date(),
      },
    });

    // Send FAMILY_CONNECTED push notification to teacher
    const teacher = await this.prisma.user.findUnique({
      where: { id: familyStudent.invited_by },
    });

    if (teacher) {
      await this.notificationsService.sendToUser(teacher.id, {
        type: NotificationType.FAMILY_CONNECTED,
        title: 'Family Connected',
        body: `A family member connected to ${familyStudent.student.first_name} ${familyStudent.student.last_name}`,
        data: {
          studentId: familyStudent.student_id,
          classId: familyStudent.class_id,
        },
      });
    }

    return {
      user: familyUser,
      connection,
      alreadyAccepted: false,
    };
  }

  /**
   * Revoke a family invite
   */
  async revokeInvite(classId: string, teacherId: string, familyStudentId: string) {
    // Verify teacher access
    const classTeacher = await this.prisma.classTeacher.findUnique({
      where: {
        class_id_teacher_id: {
          class_id: classId,
          teacher_id: teacherId,
        },
      },
    });

    if (!classTeacher) {
      throw new NotFoundException('Class not found or access denied');
    }

    // Load FamilyStudent
    const familyStudent = await this.prisma.familyStudent.findUnique({
      where: {
        id: familyStudentId,
      },
    });

    if (!familyStudent || familyStudent.class_id !== classId) {
      throw new NotFoundException('Family connection not found');
    }

    // Update status to REVOKED
    await this.prisma.familyStudent.update({
      where: {
        id: familyStudentId,
      },
      data: {
        status: FamilyStudentStatus.REVOKED,
        deleted_at: new Date(),
      },
    });

    // Try to delete Redis key (may not exist if already accepted/expired)
    // We can't reconstruct the original token, so we'll leave orphaned keys to expire naturally
    // This is acceptable since Redis TTL will clean them up

    return {
      success: true,
      data: {
        message: 'Family connection revoked successfully',
      },
      error: null,
    };
  }

  /**
   * Hash a token for Redis storage
   */
  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

}
