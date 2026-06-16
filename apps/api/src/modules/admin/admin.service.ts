import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from '../auth/mail.service';
import { CreateTeacherDto } from './dto';
import { Role, SubmissionStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';

interface DashboardStats {
  activeTeachers: number;
  submissionsToday: number;
  submissionRatePerClass: Array<{
    classId: string;
    className: string;
    submissionRate: number;
  }>;
}

interface PaginatedTeachers {
  data: Array<{
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    isActive: boolean;
    lastLoginAt: Date | null;
    classCount: number;
  }>;
  meta: {
    page: number;
    limit: number;
    total: number;
    hasMore: boolean;
  };
}

interface PaginatedClasses {
  data: Array<{
    id: string;
    name: string;
    subject: string | null;
    gradeLevel: string | null;
    teacherNames: string[];
    studentCount: number;
  }>;
  meta: {
    page: number;
    limit: number;
    total: number;
    hasMore: boolean;
  };
}

interface PaginatedStudents {
  data: Array<{
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    isActive: boolean;
    classCount: number;
  }>;
  meta: {
    page: number;
    limit: number;
    total: number;
    hasMore: boolean;
  };
}

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    private prisma: PrismaService,
    private mail: MailService,
  ) {}

  async getDashboard(schoolId: string): Promise<DashboardStats> {
    // Active teachers count
    const activeTeachers = await this.prisma.user.count({
      where: {
        role: Role.TEACHER,
        is_active: true,
        school_id: schoolId,
        deleted_at: null,
      },
    });

    // Submissions today count
    const midnight = new Date();
    midnight.setHours(0, 0, 0, 0);
    const submissionsToday = await this.prisma.submission.count({
      where: {
        created_at: { gte: midnight },
        activity: {
          class: {
            school_id: schoolId,
          },
        },
      },
    });

    // Submission rate per class
    const classes = await this.prisma.class.findMany({
      where: {
        school_id: schoolId,
        is_archived: false,
        deleted_at: null,
      },
      select: {
        id: true,
        name: true,
      },
    });

    const submissionRatePerClass = await Promise.all(
      classes.map(async (cls) => {
        const totalAssignments = await this.prisma.activityAssignment.count({
          where: {
            activity: {
              class_id: cls.id,
              status: 'PUBLISHED',
            },
            deleted_at: null,
          },
        });

        const completedSubmissions = await this.prisma.submission.count({
          where: {
            class_id: cls.id,
            status: {
              in: [SubmissionStatus.SUBMITTED, SubmissionStatus.APPROVED],
            },
          },
        });

        const rate =
          totalAssignments > 0
            ? Math.round((completedSubmissions / totalAssignments) * 100)
            : 0;

        return {
          classId: cls.id,
          className: cls.name,
          submissionRate: rate,
        };
      }),
    );

    return {
      activeTeachers,
      submissionsToday,
      submissionRatePerClass,
    };
  }

  async getTeachers(
    schoolId: string,
    page: number = 1,
    limit: number = 20,
  ): Promise<PaginatedTeachers> {
    const skip = (page - 1) * limit;

    const [teachers, total] = await Promise.all([
      this.prisma.user.findMany({
        where: {
          role: Role.TEACHER,
          school_id: schoolId,
          deleted_at: null,
        },
        select: {
          id: true,
          email: true,
          first_name: true,
          last_name: true,
          is_active: true,
          last_login_at: true,
        },
        skip,
        take: limit,
        orderBy: { last_name: 'asc' },
      }),
      this.prisma.user.count({
        where: {
          role: Role.TEACHER,
          school_id: schoolId,
          deleted_at: null,
        },
      }),
    ]);

    // Get class count for each teacher
    const teachersWithClassCount = await Promise.all(
      teachers.map(async (teacher) => {
        const classCount = await this.prisma.classTeacher.count({
          where: {
            teacher_id: teacher.id,
            deleted_at: null,
          },
        });

        return {
          id: teacher.id,
          email: teacher.email,
          firstName: teacher.first_name,
          lastName: teacher.last_name,
          isActive: teacher.is_active,
          lastLoginAt: teacher.last_login_at,
          classCount,
        };
      }),
    );

    return {
      data: teachersWithClassCount,
      meta: {
        page,
        limit,
        total,
        hasMore: skip + teachers.length < total,
      },
    };
  }

  async createTeacher(dto: CreateTeacherDto, adminId: string): Promise<any> {
    // Check if school exists
    const school = await this.prisma.school.findFirst({
      where: { id: dto.schoolId, deleted_at: null },
    });

    if (!school) {
      throw new NotFoundException('School not found');
    }

    // Check if email already exists
    const existingUser = await this.prisma.user.findFirst({
      where: {
        email: dto.email.toLowerCase().trim(),
        deleted_at: null,
      },
    });

    if (existingUser) {
      throw new BadRequestException('Email already exists');
    }

    // Generate temporary password
    const tempPassword = this.generateTempPassword();
    const passwordHash = await bcrypt.hash(tempPassword, 12);

    // Create teacher
    const teacher = await this.prisma.user.create({
      data: {
        email: dto.email.toLowerCase().trim(),
        first_name: dto.firstName.trim(),
        last_name: dto.lastName.trim(),
        role: Role.TEACHER,
        school_id: dto.schoolId,
        password_hash: passwordHash,
        is_active: true,
      },
      select: {
        id: true,
        email: true,
        first_name: true,
        last_name: true,
        role: true,
        is_active: true,
        created_at: true,
      },
    });

    // Send welcome email with temporary password
    await this.mail.send({
      to: teacher.email,
      subject: 'Welcome to EduFlow - Your Account Details',
      text: [
        `Hello ${teacher.first_name},`,
        '',
        'Your EduFlow teacher account has been created.',
        '',
        `Email: ${teacher.email}`,
        `Temporary Password: ${tempPassword}`,
        '',
        'Please log in and change your password immediately.',
        '',
        'Welcome to EduFlow!',
      ].join('\n'),
      html: `
        <p>Hello ${teacher.first_name},</p>
        <p>Your EduFlow teacher account has been created.</p>
        <p><strong>Email:</strong> ${teacher.email}<br>
        <strong>Temporary Password:</strong> ${tempPassword}</p>
        <p>Please log in and change your password immediately.</p>
        <p>Welcome to EduFlow!</p>
      `,
    });

    // Log audit entry
    await this.prisma.auditLog.create({
      data: {
        actor_id: adminId,
        action: 'USER_CREATED',
        resource_type: 'User',
        resource_id: teacher.id,
        metadata: {
          role: Role.TEACHER,
          schoolId: dto.schoolId,
        },
      },
    });

    this.logger.log(`Teacher created: ${teacher.email} by admin ${adminId}`);

    return teacher;
  }

  async deactivateTeacher(
    teacherId: string,
    adminId: string,
    schoolId: string,
  ): Promise<void> {
    // Verify teacher belongs to school
    const teacher = await this.prisma.user.findFirst({
      where: {
        id: teacherId,
        role: Role.TEACHER,
        school_id: schoolId,
        deleted_at: null,
      },
    });

    if (!teacher) {
      throw new NotFoundException('Teacher not found');
    }

    // Deactivate
    await this.prisma.user.update({
      where: { id: teacherId },
      data: { is_active: false },
    });

    // Send notification email
    await this.mail.send({
      to: teacher.email,
      subject: 'EduFlow Account Deactivated',
      text: [
        `Hello ${teacher.first_name},`,
        '',
        'Your EduFlow account has been deactivated.',
        'If you believe this is an error, please contact your school administrator.',
      ].join('\n'),
    });

    // Log audit entry
    await this.prisma.auditLog.create({
      data: {
        actor_id: adminId,
        action: 'USER_DEACTIVATED',
        resource_type: 'User',
        resource_id: teacherId,
        metadata: { schoolId },
      },
    });

    this.logger.log(
      `Teacher ${teacherId} deactivated by admin ${adminId}`,
    );
  }

  async resetPassword(
    teacherId: string,
    adminId: string,
    schoolId: string,
  ): Promise<{ success: boolean; message: string }> {
    // Verify teacher belongs to school
    const teacher = await this.prisma.user.findFirst({
      where: {
        id: teacherId,
        role: Role.TEACHER,
        school_id: schoolId,
        deleted_at: null,
      },
    });

    if (!teacher) {
      throw new NotFoundException('Teacher not found');
    }

    // Generate temporary password
    const tempPassword = this.generateTempPassword();
    const passwordHash = await bcrypt.hash(tempPassword, 12);

    // Update password
    await this.prisma.user.update({
      where: { id: teacherId },
      data: { password_hash: passwordHash },
    });

    // Send email with new password
    await this.mail.send({
      to: teacher.email,
      subject: 'EduFlow Password Reset',
      text: [
        `Hello ${teacher.first_name},`,
        '',
        'Your EduFlow password has been reset by your school administrator.',
        '',
        `New Temporary Password: ${tempPassword}`,
        '',
        'Please log in and change your password immediately.',
      ].join('\n'),
      html: `
        <p>Hello ${teacher.first_name},</p>
        <p>Your EduFlow password has been reset by your school administrator.</p>
        <p><strong>New Temporary Password:</strong> ${tempPassword}</p>
        <p>Please log in and change your password immediately.</p>
      `,
    });

    // Log audit entry
    await this.prisma.auditLog.create({
      data: {
        actor_id: adminId,
        action: 'PASSWORD_RESET',
        resource_type: 'User',
        resource_id: teacherId,
        metadata: { schoolId },
      },
    });

    this.logger.log(
      `Password reset for teacher ${teacherId} by admin ${adminId}`,
    );

    return {
      success: true,
      message: `Temporary password sent to ${teacher.email}`,
    };
  }

  async getClasses(
    schoolId: string,
    page: number = 1,
    limit: number = 20,
  ): Promise<PaginatedClasses> {
    const skip = (page - 1) * limit;

    const [classes, total] = await Promise.all([
      this.prisma.class.findMany({
        where: {
          school_id: schoolId,
          deleted_at: null,
        },
        include: {
          teachers: {
            where: { deleted_at: null },
            include: {
              teacher: {
                select: {
                  first_name: true,
                  last_name: true,
                },
              },
            },
          },
          students: {
            where: { deleted_at: null },
          },
        },
        skip,
        take: limit,
        orderBy: { name: 'asc' },
      }),
      this.prisma.class.count({
        where: {
          school_id: schoolId,
          deleted_at: null,
        },
      }),
    ]);

    const data = classes.map((cls) => ({
      id: cls.id,
      name: cls.name,
      subject: cls.subject,
      gradeLevel: cls.grade_level,
      teacherNames: cls.teachers.map(
        (t) => `${t.teacher.first_name} ${t.teacher.last_name}`,
      ),
      studentCount: cls.students.length,
    }));

    return {
      data,
      meta: {
        page,
        limit,
        total,
        hasMore: skip + classes.length < total,
      },
    };
  }

  async getStudents(
    schoolId: string,
    search?: string,
    page: number = 1,
    limit: number = 20,
  ): Promise<PaginatedStudents> {
    const skip = (page - 1) * limit;

    const whereClause: any = {
      role: Role.STUDENT,
      school_id: schoolId,
      deleted_at: null,
    };

    if (search && search.trim()) {
      whereClause.OR = [
        { first_name: { contains: search.trim(), mode: 'insensitive' } },
        { last_name: { contains: search.trim(), mode: 'insensitive' } },
        { email: { contains: search.trim(), mode: 'insensitive' } },
      ];
    }

    const [students, total] = await Promise.all([
      this.prisma.user.findMany({
        where: whereClause,
        select: {
          id: true,
          email: true,
          first_name: true,
          last_name: true,
          is_active: true,
        },
        skip,
        take: limit,
        orderBy: { last_name: 'asc' },
      }),
      this.prisma.user.count({
        where: whereClause,
      }),
    ]);

    // Get class count for each student
    const studentsWithClassCount = await Promise.all(
      students.map(async (student) => {
        const classCount = await this.prisma.classStudent.count({
          where: {
            student_id: student.id,
            deleted_at: null,
          },
        });

        return {
          id: student.id,
          email: student.email,
          firstName: student.first_name,
          lastName: student.last_name,
          isActive: student.is_active,
          classCount,
        };
      }),
    );

    return {
      data: studentsWithClassCount,
      meta: {
        page,
        limit,
        total,
        hasMore: skip + students.length < total,
      },
    };
  }

  async exportStudentPortfolio(
    studentId: string,
    adminId: string,
    schoolId: string,
  ): Promise<any> {
    // Verify student belongs to school
    const student = await this.prisma.user.findFirst({
      where: {
        id: studentId,
        role: Role.STUDENT,
        school_id: schoolId,
        deleted_at: null,
      },
    });

    if (!student) {
      throw new NotFoundException('Student not found');
    }

    // Fetch all journal posts
    const journalPosts = await this.prisma.journalPost.findMany({
      where: {
        student_id: studentId,
        deleted_at: null,
      },
      include: {
        submission: {
          select: {
            activity_id: true,
            submitted_at: true,
            teacher_feedback_text: true,
            score: true,
            max_score: true,
          },
        },
      },
      orderBy: { created_at: 'asc' },
    });

    // Fetch all submissions (including non-journal ones)
    const submissions = await this.prisma.submission.findMany({
      where: {
        student_id: studentId,
      },
      include: {
        activity: {
          select: {
            title: true,
            class: {
              select: {
                name: true,
              },
            },
          },
        },
      },
      orderBy: { created_at: 'asc' },
    });

    // Log audit entry
    await this.prisma.auditLog.create({
      data: {
        actor_id: adminId,
        action: 'DATA_EXPORT',
        resource_type: 'User',
        resource_id: studentId,
        metadata: { schoolId, exportType: 'portfolio' },
      },
    });

    this.logger.log(
      `Portfolio export for student ${studentId} by admin ${adminId}`,
    );

    return {
      student: {
        id: student.id,
        email: student.email,
        firstName: student.first_name,
        lastName: student.last_name,
      },
      journalPosts: journalPosts.map((post) => ({
        id: post.id,
        type: post.type,
        status: post.status,
        contentText: post.content_text,
        mediaUrls: post.media_urls,
        createdAt: post.created_at,
        approvedAt: post.approved_at,
        submission: post.submission,
      })),
      submissions: submissions.map((sub) => ({
        id: sub.id,
        activityTitle: sub.activity.title,
        className: sub.activity.class.name,
        status: sub.status,
        startedAt: sub.started_at,
        submittedAt: sub.submitted_at,
        teacherFeedback: sub.teacher_feedback_text,
        score: sub.score,
        maxScore: sub.max_score,
      })),
      exportedAt: new Date(),
    };
  }

  private generateTempPassword(): string {
    // Generate 12-character password with mixed case, numbers, and symbols
    const length = 12;
    const uppercase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const lowercase = 'abcdefghijklmnopqrstuvwxyz';
    const numbers = '0123456789';
    const symbols = '!@#$%';

    let password = '';
    // Ensure at least one of each type
    password += uppercase.charAt(Math.floor(Math.random() * uppercase.length));
    password += lowercase.charAt(Math.floor(Math.random() * lowercase.length));
    password += numbers.charAt(Math.floor(Math.random() * numbers.length));
    password += symbols.charAt(Math.floor(Math.random() * symbols.length));

    // Fill the rest
    const allChars = uppercase + lowercase + numbers + symbols;
    for (let i = password.length; i < length; i++) {
      password += allChars.charAt(Math.floor(Math.random() * allChars.length));
    }

    // Shuffle
    return password
      .split('')
      .sort(() => Math.random() - 0.5)
      .join('');
  }
}
