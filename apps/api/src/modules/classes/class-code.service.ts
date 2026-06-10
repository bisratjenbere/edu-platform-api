import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { randomBytes } from 'crypto';
import { Redis } from 'ioredis';
import { Role } from '@prisma/client';

@Injectable()
export class ClassCodeService {
  private redis: Redis;

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
  ) {
    const redisUrl = this.configService.get<string>('REDIS_URL') || 'redis://localhost:6379';
    this.redis = new Redis(redisUrl);
  }

  /**
   * Generate a 6-character class code for student enrollment
   */
  async generate(classId: string, teacherId: string) {
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

    // Generate 6-character uppercase alphanumeric code
    let code = this.generateCode();
    let isUnique = false;
    let attempts = 0;

    while (!isUnique && attempts < 10) {
      // Check uniqueness in database
      const existing = await this.prisma.classCode.findUnique({
        where: { code },
      });

      if (!existing) {
        isUnique = true;
      } else {
        code = this.generateCode();
      }
      attempts++;
    }

    if (!isUnique) {
      throw new BadRequestException('Failed to generate unique code. Please try again.');
    }

    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000); // 48 hours

    // Store in database
    const classCode = await this.prisma.classCode.create({
      data: {
        class_id: classId,
        code: code,
        created_by: teacherId,
        expires_at: expiresAt,
      },
    });

    // Store in Redis with 48-hour TTL
    await this.redis.setex(
      `class_code:${code}`,
      48 * 60 * 60, // 48 hours in seconds
      JSON.stringify({ classId, createdBy: teacherId }),
    );

    return {
      success: true,
      data: {
        code: classCode.code,
        expires_at: classCode.expires_at,
      },
      error: null,
    };
  }

  /**
   * Join a class using a class code (student only)
   */
  async join(studentId: string, code: string) {
    // Look up code in Redis
    const redisKey = `class_code:${code}`;
    const data = await this.redis.get(redisKey);

    if (!data) {
      throw new BadRequestException('Class code has expired or is invalid');
    }

    const { classId } = JSON.parse(data);

    // Check if student has already used this code
    const usedKey = `class_code_used:${code}:${studentId}`;
    const alreadyUsed = await this.redis.get(usedKey);

    if (alreadyUsed) {
      throw new ConflictException('You have already joined this class');
    }

    // Verify student exists
    const student = await this.prisma.user.findUnique({
      where: {
        id: studentId,
        deleted_at: null,
      },
    });

    if (!student || student.role !== Role.STUDENT) {
      throw new NotFoundException('Student not found');
    }

    // Get class to verify school match
    const classRecord = await this.prisma.class.findUnique({
      where: {
        id: classId,
        deleted_at: null,
      },
      include: {
        teachers: {
          include: {
            teacher: {
              select: {
                id: true,
                first_name: true,
                last_name: true,
              },
            },
          },
        },
        _count: {
          select: {
            students: {
              where: {
                is_active: true,
              },
            },
          },
        },
      },
    });

    if (!classRecord) {
      throw new NotFoundException('Class not found');
    }

    if (student.school_id !== classRecord.school_id) {
      throw new BadRequestException('You cannot join a class from a different school');
    }

    // Check if already a member
    const existing = await this.prisma.classStudent.findUnique({
      where: {
        class_id_student_id: {
          class_id: classId,
          student_id: studentId,
        },
      },
    });

    if (existing && existing.is_active) {
      throw new ConflictException('You are already a member of this class');
    }

    // Add student to class (or reactivate)
    await this.prisma.classStudent.upsert({
      where: {
        class_id_student_id: {
          class_id: classId,
          student_id: studentId,
        },
      },
      create: {
        class_id: classId,
        student_id: studentId,
        avatar_emoji: '🐶',
        is_active: true,
      },
      update: {
        is_active: true,
      },
    });

    // Mark code as used by this student (72-hour TTL)
    await this.redis.setex(usedKey, 72 * 60 * 60, '1');

    return {
      success: true,
      data: {
        message: 'Successfully joined class',
        class: {
          id: classRecord.id,
          name: classRecord.name,
          subject: classRecord.subject,
          grade_level: classRecord.grade_level,
          cover_color: classRecord.cover_color,
          teachers: classRecord.teachers.map((ct) => ({
            id: ct.teacher.id,
            firstName: ct.teacher.first_name,
            lastName: ct.teacher.last_name,
            role: ct.role,
          })),
          student_count: classRecord._count.students + 1, // Include the new student
        },
      },
      error: null,
    };
  }

  /**
   * Generate a 6-character uppercase alphanumeric code
   */
  private generateCode(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const bytes = randomBytes(6);
    let code = '';
    
    for (let i = 0; i < 6; i++) {
      code += chars[bytes[i] % chars.length];
    }
    
    return code;
  }

  /**
   * Cleanup method for graceful shutdown
   */
  async onModuleDestroy() {
    await this.redis.quit();
  }
}
