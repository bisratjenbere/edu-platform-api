import { Test, TestingModule } from '@nestjs/testing';
import {
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { AdminService } from './admin.service';
import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from '../auth/mail.service';
import { Role, SubmissionStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';

describe('AdminService', () => {
  let service: AdminService;
  let prisma: any;
  let mail: any;

  const mockPrismaService = {
    user: {
      count: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    submission: {
      count: jest.fn(),
    },
    class: {
      findMany: jest.fn(),
      count: jest.fn(),
    },
    activityAssignment: {
      count: jest.fn(),
    },
    classTeacher: {
      count: jest.fn(),
    },
    classStudent: {
      count: jest.fn(),
    },
    school: {
      findFirst: jest.fn(),
    },
    journalPost: {
      findMany: jest.fn(),
    },
    auditLog: {
      create: jest.fn(),
    },
  };

  const mockMailService = {
    send: jest.fn().mockResolvedValue(undefined),
    isConfigured: jest.fn().mockReturnValue(true),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
        {
          provide: MailService,
          useValue: mockMailService,
        },
      ],
    }).compile();

    service = module.get<AdminService>(AdminService);
    prisma = mockPrismaService;
    mail = mockMailService;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getDashboard', () => {
    it('should return correct dashboard stats', async () => {
      const schoolId = 'school-123';
      prisma.user.count.mockResolvedValue(15);
      prisma.submission.count.mockResolvedValue(42);
      prisma.class.findMany.mockResolvedValue([
        { id: 'class-1', name: '3rd Grade Math' },
      ]);
      prisma.activityAssignment.count.mockResolvedValue(20);
      prisma.submission.count
        .mockResolvedValueOnce(42) // submissionsToday
        .mockResolvedValueOnce(17); // completedSubmissions

      const result = await service.getDashboard(schoolId);

      expect(result.activeTeachers).toBe(15);
      expect(result.submissionsToday).toBe(42);
      expect(result.submissionRatePerClass).toHaveLength(1);
      expect(result.submissionRatePerClass[0]).toEqual({
        classId: 'class-1',
        className: '3rd Grade Math',
        submissionRate: 85,
      });
      expect(prisma.user.count).toHaveBeenCalledWith({
        where: {
          role: Role.TEACHER,
          is_active: true,
          school_id: schoolId,
          deleted_at: null,
        },
      });
    });

    it('should handle zero submission rate gracefully', async () => {
      const schoolId = 'school-123';
      prisma.user.count.mockResolvedValue(10);
      prisma.submission.count.mockResolvedValue(0);
      prisma.class.findMany.mockResolvedValue([
        { id: 'class-1', name: 'Test Class' },
      ]);
      prisma.activityAssignment.count.mockResolvedValue(0);

      const result = await service.getDashboard(schoolId);

      expect(result.submissionRatePerClass[0].submissionRate).toBe(0);
    });
  });

  describe('createTeacher', () => {
    const mockSchool = { id: 'school-123', name: 'Test School' };
    const createTeacherDto = {
      email: 'jane.smith@school.edu',
      firstName: 'Jane',
      lastName: 'Smith',
      schoolId: 'school-123',
    };
    const adminId = 'admin-123';

    it('should create teacher and send welcome email', async () => {
      prisma.school.findFirst.mockResolvedValue(mockSchool);
      prisma.user.findFirst.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue({
        id: 'teacher-123',
        email: 'jane.smith@school.edu',
        first_name: 'Jane',
        last_name: 'Smith',
        role: Role.TEACHER,
        is_active: true,
        created_at: new Date(),
      });
      prisma.auditLog.create.mockResolvedValue({});

      const result = await service.createTeacher(createTeacherDto, adminId);

      expect(result.email).toBe('jane.smith@school.edu');
      expect(prisma.school.findFirst).toHaveBeenCalledWith({
        where: { id: 'school-123', deleted_at: null },
      });
      expect(prisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            email: 'jane.smith@school.edu',
            first_name: 'Jane',
            last_name: 'Smith',
            role: Role.TEACHER,
            school_id: 'school-123',
            is_active: true,
          }),
        }),
      );
      expect(mail.send).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'jane.smith@school.edu',
          subject: expect.stringContaining('Welcome'),
        }),
      );
      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            actor_id: adminId,
            action: 'USER_CREATED',
            resource_type: 'User',
          }),
        }),
      );
    });

    it('should throw NotFoundException if school does not exist', async () => {
      prisma.school.findFirst.mockResolvedValue(null);

      await expect(
        service.createTeacher(createTeacherDto, adminId),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException if email already exists', async () => {
      prisma.school.findFirst.mockResolvedValue(mockSchool);
      prisma.user.findFirst.mockResolvedValue({ id: 'existing-user' });

      await expect(
        service.createTeacher(createTeacherDto, adminId),
      ).rejects.toThrow(BadRequestException);
    });

    it('should trim and lowercase email', async () => {
      prisma.school.findFirst.mockResolvedValue(mockSchool);
      prisma.user.findFirst.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue({
        id: 'teacher-123',
        email: 'jane.smith@school.edu',
        first_name: 'Jane',
        last_name: 'Smith',
        role: Role.TEACHER,
        is_active: true,
        created_at: new Date(),
      });

      await service.createTeacher(
        {
          ...createTeacherDto,
          email: '  Jane.Smith@School.EDU  ',
        },
        adminId,
      );

      expect(prisma.user.findFirst).toHaveBeenCalledWith({
        where: {
          email: 'jane.smith@school.edu',
          deleted_at: null,
        },
      });
    });
  });

  describe('deactivateTeacher', () => {
    const teacherId = 'teacher-123';
    const adminId = 'admin-123';
    const schoolId = 'school-123';
    const mockTeacher = {
      id: teacherId,
      email: 'teacher@school.edu',
      first_name: 'Jane',
      role: Role.TEACHER,
      school_id: schoolId,
    };

    it('should deactivate teacher and send notification email', async () => {
      prisma.user.findFirst.mockResolvedValue(mockTeacher);
      prisma.user.update.mockResolvedValue({ ...mockTeacher, is_active: false });
      prisma.auditLog.create.mockResolvedValue({});

      await service.deactivateTeacher(teacherId, adminId, schoolId);

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: teacherId },
        data: { is_active: false },
      });
      expect(mail.send).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'teacher@school.edu',
          subject: expect.stringContaining('Deactivated'),
        }),
      );
      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            actor_id: adminId,
            action: 'USER_DEACTIVATED',
            resource_id: teacherId,
          }),
        }),
      );
    });

    it('should throw NotFoundException if teacher not found', async () => {
      prisma.user.findFirst.mockResolvedValue(null);

      await expect(
        service.deactivateTeacher(teacherId, adminId, schoolId),
      ).rejects.toThrow(NotFoundException);
    });

    it('should verify teacher belongs to correct school', async () => {
      prisma.user.findFirst.mockResolvedValue(null);

      await expect(
        service.deactivateTeacher(teacherId, adminId, 'wrong-school-id'),
      ).rejects.toThrow(NotFoundException);

      expect(prisma.user.findFirst).toHaveBeenCalledWith({
        where: {
          id: teacherId,
          role: Role.TEACHER,
          school_id: 'wrong-school-id',
          deleted_at: null,
        },
      });
    });
  });

  describe('resetPassword', () => {
    const teacherId = 'teacher-123';
    const adminId = 'admin-123';
    const schoolId = 'school-123';
    const mockTeacher = {
      id: teacherId,
      email: 'teacher@school.edu',
      first_name: 'Jane',
      role: Role.TEACHER,
      school_id: schoolId,
    };

    it('should reset password and send email with temp password', async () => {
      prisma.user.findFirst.mockResolvedValue(mockTeacher);
      prisma.user.update.mockResolvedValue(mockTeacher);
      prisma.auditLog.create.mockResolvedValue({});

      const result = await service.resetPassword(teacherId, adminId, schoolId);

      expect(result.success).toBe(true);
      expect(result.message).toContain('teacher@school.edu');
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: teacherId },
        data: expect.objectContaining({
          password_hash: expect.any(String),
        }),
      });
      expect(mail.send).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'teacher@school.edu',
          subject: expect.stringContaining('Password Reset'),
          text: expect.stringContaining('Temporary Password'),
        }),
      );
      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'PASSWORD_RESET',
          }),
        }),
      );
    });

    it('should throw NotFoundException if teacher not found', async () => {
      prisma.user.findFirst.mockResolvedValue(null);

      await expect(
        service.resetPassword(teacherId, adminId, schoolId),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('getTeachers', () => {
    const schoolId = 'school-123';

    it('should return paginated teachers with class counts', async () => {
      const mockTeachers = [
        {
          id: 'teacher-1',
          email: 'teacher1@school.edu',
          first_name: 'Jane',
          last_name: 'Smith',
          is_active: true,
          last_login_at: new Date(),
        },
        {
          id: 'teacher-2',
          email: 'teacher2@school.edu',
          first_name: 'John',
          last_name: 'Doe',
          is_active: true,
          last_login_at: null,
        },
      ];

      prisma.user.findMany.mockResolvedValue(mockTeachers);
      prisma.user.count.mockResolvedValue(25);
      prisma.classTeacher.count
        .mockResolvedValueOnce(3)
        .mockResolvedValueOnce(2);

      const result = await service.getTeachers(schoolId, 1, 20);

      expect(result.data).toHaveLength(2);
      expect(result.data[0].classCount).toBe(3);
      expect(result.data[1].classCount).toBe(2);
      expect(result.meta).toEqual({
        page: 1,
        limit: 20,
        total: 25,
        hasMore: true,
      });
    });

    it('should use correct pagination parameters', async () => {
      prisma.user.findMany.mockResolvedValue([]);
      prisma.user.count.mockResolvedValue(0);

      await service.getTeachers(schoolId, 2, 10);

      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 10,
          take: 10,
        }),
      );
    });
  });

  describe('getStudents', () => {
    const schoolId = 'school-123';

    it('should return paginated students with search', async () => {
      const mockStudents = [
        {
          id: 'student-1',
          email: 'student1@school.edu',
          first_name: 'Alice',
          last_name: 'Johnson',
          is_active: true,
        },
      ];

      prisma.user.findMany.mockResolvedValue(mockStudents);
      prisma.user.count.mockResolvedValue(1);
      prisma.classStudent.count.mockResolvedValue(2);

      const result = await service.getStudents(schoolId, 'Alice', 1, 20);

      expect(result.data).toHaveLength(1);
      expect(result.data[0].firstName).toBe('Alice');
      expect(result.data[0].classCount).toBe(2);
      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: expect.arrayContaining([
              { first_name: { contains: 'Alice', mode: 'insensitive' } },
              { last_name: { contains: 'Alice', mode: 'insensitive' } },
              { email: { contains: 'Alice', mode: 'insensitive' } },
            ]),
          }),
        }),
      );
    });

    it('should work without search parameter', async () => {
      prisma.user.findMany.mockResolvedValue([]);
      prisma.user.count.mockResolvedValue(0);

      await service.getStudents(schoolId, undefined, 1, 20);

      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.not.objectContaining({
            OR: expect.anything(),
          }),
        }),
      );
    });
  });

  describe('exportStudentPortfolio', () => {
    const studentId = 'student-123';
    const adminId = 'admin-123';
    const schoolId = 'school-123';
    const mockStudent = {
      id: studentId,
      email: 'student@school.edu',
      first_name: 'Alice',
      last_name: 'Johnson',
      role: Role.STUDENT,
      school_id: schoolId,
    };

    it('should export student portfolio with journal posts and submissions', async () => {
      prisma.user.findFirst.mockResolvedValue(mockStudent);
      prisma.journalPost.findMany.mockResolvedValue([
        {
          id: 'post-1',
          type: 'ACTIVITY_SUBMISSION',
          status: 'APPROVED',
          content_text: 'My work',
          media_urls: [],
          created_at: new Date(),
          approved_at: new Date(),
          submission: { activity_id: 'activity-1' },
        },
      ]);
      prisma.submission.findMany.mockResolvedValue([
        {
          id: 'sub-1',
          status: 'SUBMITTED',
          started_at: new Date(),
          submitted_at: new Date(),
          teacher_feedback_text: 'Good work',
          score: 90,
          max_score: 100,
          activity: {
            title: 'Math Quiz',
            class: { name: '3rd Grade Math' },
          },
        },
      ]);
      prisma.auditLog.create.mockResolvedValue({});

      const result = await service.exportStudentPortfolio(
        studentId,
        adminId,
        schoolId,
      );

      expect(result.student.id).toBe(studentId);
      expect(result.journalPosts).toHaveLength(1);
      expect(result.submissions).toHaveLength(1);
      expect(result.exportedAt).toBeDefined();
      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'DATA_EXPORT',
            resource_id: studentId,
          }),
        }),
      );
    });

    it('should throw NotFoundException if student not found', async () => {
      prisma.user.findFirst.mockResolvedValue(null);

      await expect(
        service.exportStudentPortfolio(studentId, adminId, schoolId),
      ).rejects.toThrow(NotFoundException);
    });

    it('should verify student belongs to correct school', async () => {
      prisma.user.findFirst.mockResolvedValue(null);

      await expect(
        service.exportStudentPortfolio(studentId, adminId, 'wrong-school'),
      ).rejects.toThrow(NotFoundException);

      expect(prisma.user.findFirst).toHaveBeenCalledWith({
        where: {
          id: studentId,
          role: Role.STUDENT,
          school_id: 'wrong-school',
          deleted_at: null,
        },
      });
    });
  });
});
