import { Test, TestingModule } from '@nestjs/testing';
import { AssessmentService } from './assessment.service';
import { PrismaService } from '../../prisma/prisma.service';
import { SubmissionsService } from '../submissions/submissions.service';
import { JournalService } from '../journal/journal.service';
import { SubmissionStatusGateway } from '../activities/submission-status.gateway';
import {
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { Role, SubmissionStatus } from '@prisma/client';

describe('AssessmentService', () => {
  let service: AssessmentService;
  let prisma: PrismaService;
  let submissionsService: SubmissionsService;

  const mockPrisma = {
    activity: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    submission: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      aggregate: jest.fn(),
    },
    submissionBlock: {
      update: jest.fn(),
    },
    classTeacher: {
      findFirst: jest.fn(),
    },
    classStudent: {
      findFirst: jest.fn(),
      count: jest.fn(),
    },
    activityAssignment: {
      count: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
    },
  };

  const mockSubmissionsService = {
    updateFeedback: jest.fn(),
  };

  const mockJournalService = {};
  const mockGateway = {};

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AssessmentService,
        {
          provide: PrismaService,
          useValue: mockPrisma,
        },
        {
          provide: SubmissionsService,
          useValue: mockSubmissionsService,
        },
        {
          provide: JournalService,
          useValue: mockJournalService,
        },
        {
          provide: SubmissionStatusGateway,
          useValue: mockGateway,
        },
      ],
    }).compile();

    service = module.get<AssessmentService>(AssessmentService);
    prisma = module.get<PrismaService>(PrismaService);
    submissionsService = module.get<SubmissionsService>(SubmissionsService);

    jest.clearAllMocks();
  });

  describe('getAllSubmissions', () => {
    const teacherId = 'teacher-1';
    const activityId = 'activity-1';
    const classId = 'class-1';
    const schoolId = 'school-1';

    it('should return all submissions when teacher owns the class', async () => {
      const mockActivity = {
        id: activityId,
        class: {
          school_id: schoolId,
          teachers: [{ teacher_id: teacherId }],
          school: { id: schoolId },
        },
      };

      const mockSubmissions = [
        {
          id: 'sub-1',
          student_id: 'student-1',
          status: SubmissionStatus.SUBMITTED,
          score: 8,
          max_score: 10,
          submitted_at: new Date(),
          student: {
            id: 'student-1',
            first_name: 'John',
            last_name: 'Doe',
            email: 'john@example.com',
          },
          blocks: [
            {
              id: 'block-1',
              block_id: 'activity-block-1',
              auto_score: 8,
              response_content: { answer: 'test' },
            },
          ],
        },
      ];

      mockPrisma.activity.findUnique.mockResolvedValue(mockActivity);
      mockPrisma.submission.findMany.mockResolvedValue(mockSubmissions);

      const result = await service.getAllSubmissions(
        activityId,
        teacherId,
        Role.TEACHER,
      );

      expect(result).toEqual(mockSubmissions);
      expect(mockPrisma.activity.findUnique).toHaveBeenCalledWith({
        where: { id: activityId, deleted_at: null },
        include: {
          class: {
            include: {
              teachers: true,
              school: true,
            },
          },
        },
      });
    });

    it('should allow SCHOOL_ADMIN from same school to view submissions', async () => {
      const adminId = 'admin-1';
      const mockActivity = {
        id: activityId,
        class: {
          school_id: schoolId,
          teachers: [],
          school: { id: schoolId },
        },
      };

      const mockAdmin = {
        id: adminId,
        school_id: schoolId,
      };

      mockPrisma.activity.findUnique.mockResolvedValue(mockActivity);
      mockPrisma.user.findUnique.mockResolvedValue(mockAdmin);
      mockPrisma.submission.findMany.mockResolvedValue([]);

      await service.getAllSubmissions(activityId, adminId, Role.SCHOOL_ADMIN);

      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: adminId, deleted_at: null },
      });
    });

    it('should throw ForbiddenException if teacher does not own the class', async () => {
      const mockActivity = {
        id: activityId,
        class: {
          school_id: schoolId,
          teachers: [{ teacher_id: 'other-teacher' }],
          school: { id: schoolId },
        },
      };

      mockPrisma.activity.findUnique.mockResolvedValue(mockActivity);

      await expect(
        service.getAllSubmissions(activityId, teacherId, Role.TEACHER),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw NotFoundException if activity does not exist', async () => {
      mockPrisma.activity.findUnique.mockResolvedValue(null);

      await expect(
        service.getAllSubmissions(activityId, teacherId, Role.TEACHER),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateFeedback', () => {
    const teacherId = 'teacher-1';
    const submissionId = 'sub-1';

    it('should delegate to SubmissionsService', async () => {
      const mockSubmission = {
        id: submissionId,
        activity: {
          class: {
            teachers: [{ teacher_id: teacherId }],
          },
        },
      };

      const dto = {
        status: SubmissionStatus.APPROVED,
        feedback_text: 'Great work!',
      };

      const mockUpdated = { ...mockSubmission, status: SubmissionStatus.APPROVED };

      mockPrisma.submission.findUnique.mockResolvedValue(mockSubmission);
      mockSubmissionsService.updateFeedback.mockResolvedValue(mockUpdated);

      const result = await service.updateFeedback(submissionId, teacherId, dto);

      expect(mockSubmissionsService.updateFeedback).toHaveBeenCalledWith(
        submissionId,
        teacherId,
        dto,
      );
      expect(result).toEqual(mockUpdated);
    });

    it('should throw ForbiddenException if teacher does not own the class', async () => {
      const mockSubmission = {
        id: submissionId,
        activity: {
          class: {
            teachers: [],
          },
        },
      };

      mockPrisma.submission.findUnique.mockResolvedValue(mockSubmission);

      await expect(
        service.updateFeedback(submissionId, teacherId, {
          status: SubmissionStatus.APPROVED,
        }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('saveAnnotation', () => {
    const teacherId = 'teacher-1';
    const submissionId = 'sub-1';
    const blockId = 'block-1';

    it('should save annotation successfully', async () => {
      const mockSubmission = {
        id: submissionId,
        activity: {
          class: {
            teachers: [{ teacher_id: teacherId }],
          },
        },
        blocks: [{ id: blockId, block_id: 'activity-block-1' }],
      };

      const dto = {
        block_id: 'activity-block-1',
        annotation_json: '{"strokes":[]}',
      };

      const mockUpdated = {
        ...mockSubmission.blocks[0],
        annotation_json: dto.annotation_json,
      };

      mockPrisma.submission.findUnique.mockResolvedValue(mockSubmission);
      mockPrisma.submissionBlock.update.mockResolvedValue(mockUpdated);

      const result = await service.saveAnnotation(submissionId, teacherId, dto);

      expect(mockPrisma.submissionBlock.update).toHaveBeenCalledWith({
        where: { id: blockId },
        data: {
          annotation_json: dto.annotation_json,
        },
      });
      expect(result).toEqual(mockUpdated);
    });

    it('should throw NotFoundException if block does not exist', async () => {
      const mockSubmission = {
        id: submissionId,
        activity: {
          class: {
            teachers: [{ teacher_id: teacherId }],
          },
        },
        blocks: [],
      };

      mockPrisma.submission.findUnique.mockResolvedValue(mockSubmission);

      await expect(
        service.saveAnnotation(submissionId, teacherId, {
          block_id: 'nonexistent',
          annotation_json: '{}',
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('getClassAnalytics', () => {
    const teacherId = 'teacher-1';
    const classId = 'class-1';

    it('should return correct analytics aggregations', async () => {
      mockPrisma.classTeacher.findFirst.mockResolvedValue({
        class_id: classId,
        teacher_id: teacherId,
      });

      mockPrisma.activity.findMany.mockResolvedValue([
        { id: 'activity-1' },
        { id: 'activity-2' },
      ]);

      mockPrisma.classStudent.count.mockResolvedValue(10);
      mockPrisma.activity.count.mockResolvedValue(2);
      mockPrisma.activityAssignment.count.mockResolvedValue(5);
      mockPrisma.submission.count.mockResolvedValue(15);
      mockPrisma.submission.aggregate.mockResolvedValue({
        _avg: { score: 8.5 },
      });
      mockPrisma.submission.findMany.mockResolvedValue([
        { score: 5, max_score: 10 }, // 50% -> range_26_50
        { score: 9, max_score: 10 }, // 90% -> range_76_100
        { score: 2, max_score: 10 }, // 20% -> range_0_25
      ]);

      const result = await service.getClassAnalytics(classId, teacherId);

      expect(result.submissionRate).toBe(60); // 15 / (2*10 + 5) = 60%
      expect(result.averageScore).toBe(8.5);
      expect(result.scoreDistribution.range_0_25).toBe(1);
      expect(result.scoreDistribution.range_26_50).toBe(1);
      expect(result.scoreDistribution.range_76_100).toBe(1);
    });

    it('should throw ForbiddenException if teacher does not own class', async () => {
      mockPrisma.classTeacher.findFirst.mockResolvedValue(null);

      await expect(
        service.getClassAnalytics(classId, teacherId),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('getStudentProgress', () => {
    const teacherId = 'teacher-1';
    const studentId = 'student-1';

    it('should return weekly submissions and standards mastery', async () => {
      mockPrisma.classStudent.findFirst.mockResolvedValue({
        student_id: studentId,
        class_id: 'class-1',
      });

      const mockSubmissions = [
        {
          submitted_at: new Date('2026-06-09'),
        },
        {
          submitted_at: new Date('2026-06-10'),
        },
      ];

      mockPrisma.submission.findMany
        .mockResolvedValueOnce(mockSubmissions) // Weekly submissions query
        .mockResolvedValueOnce([
          // Standards mastery query
          {
            blocks: [
              { block_id: 'block-1', auto_score: 1 },
              { block_id: 'block-2', auto_score: 0.5 },
            ],
            activity: {
              standards_tags: ['CCSS.MATH.1.OA.1'],
              blocks: [
                { id: 'block-1', type: 'MULTIPLE_CHOICE' },
                { id: 'block-2', type: 'MULTIPLE_CHOICE' },
              ],
            },
          },
        ]);

      const result = await service.getStudentProgress(studentId, teacherId);

      expect(result.weeklySubmissions).toBeDefined();
      expect(result.standardsMastery).toBeDefined();
      expect(Array.isArray(result.weeklySubmissions)).toBe(true);
      expect(Array.isArray(result.standardsMastery)).toBe(true);
    });

    it('should throw ForbiddenException if teacher does not have access to student', async () => {
      mockPrisma.classStudent.findFirst.mockResolvedValue(null);

      await expect(
        service.getStudentProgress(studentId, teacherId),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
