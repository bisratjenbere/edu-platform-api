import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { PrismaService } from '../../prisma/prisma.service';
import { Role, FluencyStatus, GradeLevel } from '@prisma/client';
import { CreateAssessmentDto, SubmitRecordingDto, GetByClassQueryDto } from './dto';

interface FluencyAnalysisJobPayload {
  assessmentId: string;
  studentId: string;
  teacherId: string;
  recordingKey: string;
  passageText: string;
  classId: string;
  gradeLevel: GradeLevel;
}

@Injectable()
export class FluencyService {
  private readonly logger = new Logger(FluencyService.name);

  constructor(
    private prisma: PrismaService,
    @InjectQueue('fluency-analysis') private fluencyQueue: Queue,
  ) {}

  /**
   * US-FLU-01 — Teacher creates a reading fluency assessment with a passage.
   * Validates word count, verifies teacher/student are in the class,
   * and records the grade level from the student's ClassStudent row.
   */
  async create(teacherId: string, dto: CreateAssessmentDto) {
    // Word count validated by @IsWordCountBetween in DTO, but defensive re-check
    const wordCount = dto.passage_text
      .trim()
      .split(/\s+/)
      .filter((w) => w.length > 0).length;

    if (wordCount < 20) {
      throw new BadRequestException('Passage must be at least 20 words');
    }
    if (wordCount > 500) {
      throw new BadRequestException('Passage cannot exceed 500 words');
    }

    // Verify teacher is in this class
    const classTeacher = await this.prisma.classTeacher.findFirst({
      where: {
        class_id: dto.class_id,
        teacher_id: teacherId,
        deleted_at: null,
      },
    });
    if (!classTeacher) {
      throw new ForbiddenException(
        'You are not a teacher of this class',
      );
    }

    // Verify student is enrolled in this class — also fetch grade_level
    const classStudent = await this.prisma.classStudent.findFirst({
      where: {
        class_id: dto.class_id,
        student_id: dto.student_id,
        deleted_at: null,
        is_active: true,
      },
      include: {
        class: {
          select: { grade_level: true },
        },
      },
    });
    if (!classStudent) {
      throw new BadRequestException(
        'Student is not enrolled in this class',
      );
    }

    const assessment = await this.prisma.fluencyAssessment.create({
      data: {
        student_id: dto.student_id,
        teacher_id: teacherId,
        class_id: dto.class_id,
        passage_text: dto.passage_text,
        grade_level: classStudent.class.grade_level ?? null,
        status: FluencyStatus.PENDING,
      },
    });

    this.logger.log(
      `FluencyAssessment created: ${assessment.id} (teacher: ${teacherId}, student: ${dto.student_id})`,
    );

    return assessment;
  }

  /**
   * US-FLU-02 — Student submits a recording S3 key.
   * Validates ownership of the key, transitions status to PROCESSING,
   * and enqueues FluencyAnalysisJob.
   */
  async submitRecording(
    assessmentId: string,
    studentId: string,
    dto: SubmitRecordingDto,
  ) {
    // Fetch the assessment (findUnique — must include deleted_at: null manually per prisma-middleware.md)
    const assessment = await this.prisma.fluencyAssessment.findUnique({
      where: { id: assessmentId },
    });

    if (!assessment || assessment.deleted_at !== null) {
      throw new NotFoundException('Assessment not found');
    }

    // Student can only submit to their own assessment
    if (assessment.student_id !== studentId) {
      throw new ForbiddenException(
        'You are not the student for this assessment',
      );
    }

    // Reject re-submissions once processing has started
    if (
      assessment.status === FluencyStatus.PROCESSING ||
      assessment.status === FluencyStatus.COMPLETE
    ) {
      throw new ConflictException('Recording already submitted');
    }

    // Verify S3 key ownership: format is folder/userId/uuid.ext
    const segments = dto.recording_key.split('/');
    if (segments.length !== 3 || segments[1] !== studentId) {
      throw new BadRequestException(
        'Recording key does not belong to this student',
      );
    }

    // Persist and transition to PROCESSING
    const updated = await this.prisma.fluencyAssessment.update({
      where: { id: assessmentId },
      data: {
        recording_url: dto.recording_key,
        status: FluencyStatus.PROCESSING,
      },
    });

    // Enqueue analysis job
    const jobPayload: FluencyAnalysisJobPayload = {
      assessmentId: assessment.id,
      studentId: assessment.student_id,
      teacherId: assessment.teacher_id,
      recordingKey: dto.recording_key,
      passageText: assessment.passage_text,
      classId: assessment.class_id,
      gradeLevel: assessment.grade_level ?? GradeLevel.G1,
    };

    await this.fluencyQueue.add('analyse', jobPayload, {
      attempts: 2,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: true,
      removeOnFail: false,
    });

    this.logger.log(
      `FluencyAnalysisJob enqueued for assessment ${assessmentId}`,
    );

    return updated;
  }

  /**
   * US-FLU-04 — Get a single assessment with full analysis JSON.
   * Teachers see any assessment in their class; students see only their own.
   */
  async getAssessment(
    assessmentId: string,
    requesterId: string,
    requesterRole: Role,
  ) {
    const assessment = await this.prisma.fluencyAssessment.findUnique({
      where: { id: assessmentId },
    });

    if (!assessment || assessment.deleted_at !== null) {
      throw new NotFoundException('Assessment not found');
    }

    if (requesterRole === Role.TEACHER) {
      const classTeacher = await this.prisma.classTeacher.findFirst({
        where: {
          class_id: assessment.class_id,
          teacher_id: requesterId,
          deleted_at: null,
        },
      });
      if (!classTeacher) {
        throw new ForbiddenException(
          'You are not a teacher of this class',
        );
      }
    } else {
      // STUDENT — can only see their own
      if (assessment.student_id !== requesterId) {
        throw new ForbiddenException(
          'You are not the student for this assessment',
        );
      }
    }

    return assessment;
  }

  /**
   * US-FLU-05 — Teacher gets all assessments for a class.
   * Supports optional ?studentId and ?status filters.
   * Returns each assessment with the student's first and last name.
   */
  async getByClass(
    classId: string,
    teacherId: string,
    query: GetByClassQueryDto,
  ) {
    // Verify teacher owns the class
    const classTeacher = await this.prisma.classTeacher.findFirst({
      where: {
        class_id: classId,
        teacher_id: teacherId,
        deleted_at: null,
      },
    });
    if (!classTeacher) {
      throw new ForbiddenException(
        'You are not a teacher of this class',
      );
    }

    const assessments = await this.prisma.fluencyAssessment.findMany({
      where: {
        class_id: classId,
        ...(query.studentId ? { student_id: query.studentId } : {}),
        ...(query.status ? { status: query.status } : {}),
        deleted_at: null,
      },
      orderBy: { created_at: 'desc' },
      include: {
        student: {
          select: {
            id: true,
            first_name: true,
            last_name: true,
          },
        },
      },
    });

    return assessments.map((a) => ({
      id: a.id,
      student: a.student,
      status: a.status,
      wpm: (a.analysis as Record<string, unknown> | null)?.['wpm'] ?? null,
      accuracy:
        (a.analysis as Record<string, unknown> | null)?.['accuracy'] ?? null,
      fluencyScore:
        (a.analysis as Record<string, unknown> | null)?.['fluencyScore'] ?? null,
      created_at: a.created_at,
    }));
  }
}
