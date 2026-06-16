import { Test, TestingModule } from '@nestjs/testing';
import { FluencyService } from './fluency.service';
import { PrismaService } from '../../prisma/prisma.service';
import { getQueueToken } from '@nestjs/bull';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { FluencyStatus, GradeLevel, Role } from '@prisma/client';

describe('FluencyService', () => {
  let service: FluencyService;

  const mockQueue = {
    add: jest.fn().mockResolvedValue({ id: 'job-1' }),
  };

  const mockAssessment = {
    id: 'assessment-1',
    student_id: 'student-1',
    teacher_id: 'teacher-1',
    class_id: 'class-1',
    passage_text: 'The quick brown fox jumps over the lazy dog and runs away',
    grade_level: GradeLevel.G3,
    status: FluencyStatus.PENDING,
    recording_url: null,
    transcript: null,
    analysis: null,
    deleted_at: null,
    created_at: new Date(),
    updated_at: new Date(),
  };

  const mockPrisma = {
    classTeacher: { findFirst: jest.fn() },
    classStudent: { findFirst: jest.fn() },
    fluencyAssessment: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FluencyService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: getQueueToken('fluency-analysis'), useValue: mockQueue },
      ],
    }).compile();

    service = module.get<FluencyService>(FluencyService);
    jest.clearAllMocks();
  });

  // ─── create ──────────────────────────────────────────────────────────────

  describe('create', () => {
    const dto = {
      class_id: 'class-1',
      student_id: 'student-1',
      passage_text:
        'The quick brown fox jumps over the lazy dog and keeps running far away across the field',
    };

    it('creates assessment when teacher and student are in class', async () => {
      mockPrisma.classTeacher.findFirst.mockResolvedValue({ class_id: 'class-1' });
      mockPrisma.classStudent.findFirst.mockResolvedValue({
        class_id: 'class-1',
        class: { grade_level: GradeLevel.G3 },
      });
      mockPrisma.fluencyAssessment.create.mockResolvedValue(mockAssessment);

      const result = await service.create('teacher-1', dto);

      expect(result).toEqual(mockAssessment);
      expect(mockPrisma.fluencyAssessment.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          status: FluencyStatus.PENDING,
          passage_text: dto.passage_text,
        }),
      });
    });

    it('throws 400 when passage has fewer than 20 words', async () => {
      await expect(
        service.create('teacher-1', { ...dto, passage_text: 'too short' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws 400 when passage has more than 500 words', async () => {
      const longPassage = Array(501).fill('word').join(' ');
      await expect(
        service.create('teacher-1', { ...dto, passage_text: longPassage }),
      ).rejects.toThrow(BadRequestException);

      const err = await service
        .create('teacher-1', { ...dto, passage_text: longPassage })
        .catch((e) => e as BadRequestException);
      expect(err.message).toBe('Passage cannot exceed 500 words');
    });

    it('throws 403 when teacher is not in class', async () => {
      mockPrisma.classTeacher.findFirst.mockResolvedValue(null);
      await expect(service.create('teacher-1', dto)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('throws 400 when student is not enrolled', async () => {
      mockPrisma.classTeacher.findFirst.mockResolvedValue({ class_id: 'class-1' });
      mockPrisma.classStudent.findFirst.mockResolvedValue(null);
      await expect(service.create('teacher-1', dto)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // ─── submitRecording ─────────────────────────────────────────────────────

  describe('submitRecording', () => {
    const dto = { recording_key: 'fluency/student-1/uuid-abc.webm' };

    it('updates status to PROCESSING and enqueues job', async () => {
      mockPrisma.fluencyAssessment.findUnique.mockResolvedValue(mockAssessment);
      mockPrisma.fluencyAssessment.update.mockResolvedValue({
        ...mockAssessment,
        status: FluencyStatus.PROCESSING,
        recording_url: dto.recording_key,
      });

      const result = await service.submitRecording('assessment-1', 'student-1', dto);

      expect(result.status).toBe(FluencyStatus.PROCESSING);
      expect(mockQueue.add).toHaveBeenCalledWith(
        'analyse',
        expect.objectContaining({ assessmentId: 'assessment-1' }),
        expect.any(Object),
      );
    });

    it('throws 404 when assessment not found', async () => {
      mockPrisma.fluencyAssessment.findUnique.mockResolvedValue(null);
      await expect(
        service.submitRecording('assessment-1', 'student-1', dto),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws 403 when student does not own the assessment', async () => {
      mockPrisma.fluencyAssessment.findUnique.mockResolvedValue({
        ...mockAssessment,
        student_id: 'other-student',
      });
      await expect(
        service.submitRecording('assessment-1', 'student-1', dto),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws 409 when status is already PROCESSING', async () => {
      mockPrisma.fluencyAssessment.findUnique.mockResolvedValue({
        ...mockAssessment,
        status: FluencyStatus.PROCESSING,
      });
      await expect(
        service.submitRecording('assessment-1', 'student-1', dto),
      ).rejects.toThrow(ConflictException);
    });

    it('throws 409 when status is COMPLETE', async () => {
      mockPrisma.fluencyAssessment.findUnique.mockResolvedValue({
        ...mockAssessment,
        status: FluencyStatus.COMPLETE,
      });
      await expect(
        service.submitRecording('assessment-1', 'student-1', dto),
      ).rejects.toThrow(ConflictException);
    });

    it('throws 400 when recording_key userId segment does not match student', async () => {
      mockPrisma.fluencyAssessment.findUnique.mockResolvedValue(mockAssessment);
      await expect(
        service.submitRecording('assessment-1', 'student-1', {
          recording_key: 'fluency/other-student/uuid.webm',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ─── getAssessment ───────────────────────────────────────────────────────

  describe('getAssessment', () => {
    it('returns assessment for teacher who is in class', async () => {
      mockPrisma.fluencyAssessment.findUnique.mockResolvedValue(mockAssessment);
      mockPrisma.classTeacher.findFirst.mockResolvedValue({ class_id: 'class-1' });

      const result = await service.getAssessment(
        'assessment-1',
        'teacher-1',
        Role.TEACHER,
      );
      expect(result).toEqual(mockAssessment);
    });

    it('returns assessment for the owning student', async () => {
      mockPrisma.fluencyAssessment.findUnique.mockResolvedValue(mockAssessment);

      const result = await service.getAssessment(
        'assessment-1',
        'student-1',
        Role.STUDENT,
      );
      expect(result).toEqual(mockAssessment);
    });

    it('throws 403 when teacher is not in class', async () => {
      mockPrisma.fluencyAssessment.findUnique.mockResolvedValue(mockAssessment);
      mockPrisma.classTeacher.findFirst.mockResolvedValue(null);

      await expect(
        service.getAssessment('assessment-1', 'other-teacher', Role.TEACHER),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws 403 when student requests another student\'s assessment', async () => {
      mockPrisma.fluencyAssessment.findUnique.mockResolvedValue(mockAssessment);

      await expect(
        service.getAssessment('assessment-1', 'other-student', Role.STUDENT),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws 404 when assessment not found', async () => {
      mockPrisma.fluencyAssessment.findUnique.mockResolvedValue(null);

      await expect(
        service.getAssessment('assessment-1', 'teacher-1', Role.TEACHER),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─── getByClass ──────────────────────────────────────────────────────────

  describe('getByClass', () => {
    it('returns assessments with student names for teacher', async () => {
      mockPrisma.classTeacher.findFirst.mockResolvedValue({ class_id: 'class-1' });
      mockPrisma.fluencyAssessment.findMany.mockResolvedValue([
        {
          ...mockAssessment,
          analysis: { wpm: 95, accuracy: 92.3, fluencyScore: 88.5 },
          student: { id: 'student-1', first_name: 'Jane', last_name: 'Doe' },
        },
      ]);

      const result = await service.getByClass('class-1', 'teacher-1', {});

      expect(result).toHaveLength(1);
      expect(result[0].student.first_name).toBe('Jane');
      expect(result[0].wpm).toBe(95);
      expect(result[0].accuracy).toBe(92.3);
    });

    it('throws 403 when teacher is not in class', async () => {
      mockPrisma.classTeacher.findFirst.mockResolvedValue(null);
      await expect(
        service.getByClass('class-1', 'other-teacher', {}),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
