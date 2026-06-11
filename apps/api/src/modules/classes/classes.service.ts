import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateClassDto, UpdateClassDto, AddCoTeacherDto, AddStudentDto } from './dto';
import { CoTeacherRole, Role } from '@prisma/client';

@Injectable()
export class ClassesService {
  constructor(private prisma: PrismaService) {}

  /**
   * Create a new class with the requesting teacher as PRIMARY
   */
  async create(teacherId: string, schoolId: string, dto: CreateClassDto) {
    // Check for duplicate name within same school year and school
    const existing = await this.prisma.class.findFirst({
      where: {
        name: dto.name,
        school_year: dto.school_year,
        school_id: schoolId,
        deleted_at: null,
      },
    });

    if (existing) {
      throw new ConflictException('A class with this name already exists for this school year');
    }

    // Create class with teacher as PRIMARY in a transaction
    const classRecord = await this.prisma.class.create({
      data: {
        name: dto.name,
        subject: dto.subject,
        grade_level: dto.grade_level,
        school_year: dto.school_year,
        cover_color: dto.cover_color || '#4F46E5',
        school_id: schoolId,
        teachers: {
          create: {
            teacher_id: teacherId,
            role: CoTeacherRole.PRIMARY,
          },
        },
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
            students: true,
          },
        },
      },
    });

    return {
      success: true,
      data: this.formatClassDetail(classRecord, 0),
      error: null,
    };
  }

  /**
   * List all classes where the teacher is a ClassTeacher
   */
  async findAll(teacherId: string, includeArchived = false) {
    const classes = await this.prisma.class.findMany({
      where: {
        teachers: {
          some: {
            teacher_id: teacherId,
          },
        },
        is_archived: includeArchived ? undefined : false,
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
      orderBy: {
        created_at: 'desc',
      },
    });

    // Get pending submission counts for each class
    const classesWithCounts = await Promise.all(
      classes.map(async (classRecord) => {
        const pendingCount = await this.prisma.submission.count({
          where: {
            class_id: classRecord.id,
            status: 'SUBMITTED',
          },
        });

        return this.formatClassDetail(classRecord, pendingCount);
      }),
    );

    return {
      success: true,
      data: classesWithCounts,
      error: null,
    };
  }

  /**
   * Get class detail by ID (verify requester is a teacher)
   */
  async findOne(classId: string, requesterId: string) {
    await this.verifyTeacherAccess(classId, requesterId);

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

    const pendingCount = await this.prisma.submission.count({
      where: {
        class_id: classId,
        status: 'SUBMITTED',
      },
    });

    return {
      success: true,
      data: this.formatClassDetail(classRecord, pendingCount),
      error: null,
    };
  }

  /**
   * Update class details (PRIMARY or CO_TEACHER can update)
   */
  async update(classId: string, teacherId: string, dto: UpdateClassDto) {
    await this.verifyTeacherAccess(classId, teacherId);

    const updated = await this.prisma.class.update({
      where: {
        id: classId,
        deleted_at: null,
      },
      data: {
        name: dto.name,
        subject: dto.subject,
        grade_level: dto.grade_level,
        school_year: dto.school_year,
        cover_color: dto.cover_color,
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

    const pendingCount = await this.prisma.submission.count({
      where: {
        class_id: classId,
        status: 'SUBMITTED',
      },
    });

    return {
      success: true,
      data: this.formatClassDetail(updated, pendingCount),
      error: null,
    };
  }

  /**
   * Archive a class (PRIMARY only)
   */
  async archive(classId: string, teacherId: string) {
    await this.verifyPrimaryTeacher(classId, teacherId);

    await this.prisma.class.update({
      where: {
        id: classId,
        deleted_at: null,
      },
      data: {
        is_archived: true,
      },
    });

    return {
      success: true,
      data: {
        message: 'Class archived successfully',
      },
      error: null,
    };
  }

  /**
   * Soft delete a class (PRIMARY only)
   */
  async softDelete(classId: string, teacherId: string) {
    await this.verifyPrimaryTeacher(classId, teacherId);

    await this.prisma.class.update({
      where: {
        id: classId,
        deleted_at: null,
      },
      data: {
        deleted_at: new Date(),
      },
    });

    return {
      success: true,
      data: {
        message: 'Class deleted successfully',
      },
      error: null,
    };
  }

  /**
   * Add a co-teacher (PRIMARY only)
   */
  async addCoTeacher(classId: string, requesterId: string, dto: AddCoTeacherDto) {
    await this.verifyPrimaryTeacher(classId, requesterId);

    // Get class to find school_id
    const classRecord = await this.prisma.class.findUnique({
      where: { id: classId, deleted_at: null },
      select: { school_id: true },
    });

    if (!classRecord) {
      throw new NotFoundException('Class not found');
    }

    // Find teacher by email in same school
    const teacher = await this.prisma.user.findFirst({
      where: {
        email: dto.email,
        role: Role.TEACHER,
        school_id: classRecord.school_id,
        deleted_at: null,
      },
    });

    if (!teacher) {
      throw new NotFoundException('No teacher found with that email in your school');
    }

    // Check if already a co-teacher
    const existing = await this.prisma.classTeacher.findUnique({
      where: {
        class_id_teacher_id: {
          class_id: classId,
          teacher_id: teacher.id,
        },
      },
    });

    if (existing) {
      throw new ConflictException('Teacher is already a co-teacher of this class');
    }

    // Add as CO_TEACHER
    await this.prisma.classTeacher.create({
      data: {
        class_id: classId,
        teacher_id: teacher.id,
        role: CoTeacherRole.CO_TEACHER,
      },
    });

    // TODO: Send email notification to the new co-teacher

    return {
      success: true,
      data: {
        message: 'Co-teacher added successfully',
        teacher: {
          id: teacher.id,
          first_name: teacher.first_name,
          last_name: teacher.last_name,
          email: teacher.email,
        },
      },
      error: null,
    };
  }

  /**
   * Remove a co-teacher (PRIMARY only, cannot remove PRIMARY)
   */
  async removeCoTeacher(classId: string, requesterId: string, targetTeacherId: string) {
    await this.verifyPrimaryTeacher(classId, requesterId);

    // Get target teacher's role
    const target = await this.prisma.classTeacher.findUnique({
      where: {
        class_id_teacher_id: {
          class_id: classId,
          teacher_id: targetTeacherId,
        },
      },
    });

    if (!target) {
      throw new NotFoundException('Co-teacher not found');
    }

    if (target.role === CoTeacherRole.PRIMARY) {
      throw new BadRequestException('Cannot remove the primary teacher');
    }

    // Delete ClassTeacher record
    await this.prisma.classTeacher.delete({
      where: {
        class_id_teacher_id: {
          class_id: classId,
          teacher_id: targetTeacherId,
        },
      },
    });

    return {
      success: true,
      data: {
        message: 'Co-teacher removed successfully',
      },
      error: null,
    };
  }

  /**
   * Add a student to the class
   */
  async addStudent(classId: string, teacherId: string, dto: AddStudentDto) {
    await this.verifyTeacherAccess(classId, teacherId);

    // Verify student exists and is in same school
    const classRecord = await this.prisma.class.findUnique({
      where: { id: classId, deleted_at: null },
      select: { school_id: true },
    });

    if (!classRecord) {
      throw new NotFoundException('Class not found');
    }

    const student = await this.prisma.user.findUnique({
      where: {
        id: dto.student_id,
        deleted_at: null,
      },
    });

    if (!student || student.role !== Role.STUDENT) {
      throw new NotFoundException('Student not found');
    }

    if (student.school_id !== classRecord.school_id) {
      throw new ForbiddenException('Student must be in the same school as the class');
    }

    // Upsert ClassStudent (reactivate if previously removed)
    await this.prisma.classStudent.upsert({
      where: {
        class_id_student_id: {
          class_id: classId,
          student_id: dto.student_id,
        },
      },
      create: {
        class_id: classId,
        student_id: dto.student_id,
        avatar_emoji: '🐶',
        is_active: true,
      },
      update: {
        is_active: true,
      },
    });

    return {
      success: true,
      data: {
        message: 'Student added successfully',
        student: {
          id: student.id,
          first_name: student.first_name,
          last_name: student.last_name,
        },
      },
      error: null,
    };
  }

  /**
   * Remove a student from the class (soft remove, preserves submission history)
   */
  async removeStudent(classId: string, teacherId: string, studentId: string) {
    await this.verifyTeacherAccess(classId, teacherId);

    // Set ClassStudent.is_active = false
    await this.prisma.classStudent.update({
      where: {
        class_id_student_id: {
          class_id: classId,
          student_id: studentId,
        },
      },
      data: {
        is_active: false,
      },
    });

    // Revoke all FamilyStudent connections for this student in this class
    await this.prisma.familyStudent.updateMany({
      where: {
        student_id: studentId,
        class_id: classId,
        deleted_at: null,
      },
      data: {
        deleted_at: new Date(),
        status: 'REVOKED',
      },
    });

    return {
      success: true,
      data: {
        message: 'Student removed successfully',
      },
      error: null,
    };
  }

  /**
   * Helper: Verify requester is a teacher of the class
   */
  private async verifyTeacherAccess(classId: string, teacherId: string): Promise<void> {
    const classTeacher = await this.prisma.classTeacher.findUnique({
      where: {
        class_id_teacher_id: {
          class_id: classId,
          teacher_id: teacherId,
        },
      },
    });

    if (!classTeacher) {
      throw new ForbiddenException('You do not have access to this class');
    }
  }

  /**
   * Helper: Verify requester is PRIMARY teacher
   */
  private async verifyPrimaryTeacher(classId: string, teacherId: string): Promise<void> {
    const classTeacher = await this.prisma.classTeacher.findUnique({
      where: {
        class_id_teacher_id: {
          class_id: classId,
          teacher_id: teacherId,
        },
      },
    });

    if (!classTeacher) {
      throw new ForbiddenException('You do not have access to this class');
    }

    if (classTeacher.role !== CoTeacherRole.PRIMARY) {
      throw new ForbiddenException('Only the primary teacher can perform this action');
    }
  }

  /**
   * Helper: Format class detail response
   */
  private formatClassDetail(classRecord: any, pendingSubmissionCount: number) {
    return {
      id: classRecord.id,
      name: classRecord.name,
      subject: classRecord.subject,
      grade_level: classRecord.grade_level,
      school_year: classRecord.school_year,
      cover_color: classRecord.cover_color,
      is_archived: classRecord.is_archived,
      teachers: classRecord.teachers.map((ct: any) => ({
        id: ct.teacher.id,
        firstName: ct.teacher.first_name,
        lastName: ct.teacher.last_name,
        role: ct.role,
      })),
      student_count: classRecord._count.students,
      pending_submission_count: pendingSubmissionCount,
      created_at: classRecord.created_at,
    };
  }
}
