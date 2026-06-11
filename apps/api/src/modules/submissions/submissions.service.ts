import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  Logger,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SubmissionStatus, Submission, NotificationType } from '@prisma/client';
import { UpdateSubmissionBlockDto, TeacherFeedbackDto } from './dto';
import { AutoGradeService } from './auto-grade.service';
import { SubmissionStatusGateway } from '../activities/submission-status.gateway';
import { JournalService } from '../journal/journal.service';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class SubmissionsService {
  private readonly logger = new Logger(SubmissionsService.name);

  constructor(
    private prisma: PrismaService,
    private autoGradeService: AutoGradeService,
    private submissionStatusGateway: SubmissionStatusGateway,
    @Inject(forwardRef(() => JournalService))
    private readonly journalService: JournalService,
    @Inject(forwardRef(() => NotificationsService))
    private readonly notificationsService: NotificationsService,
  ) {}

  async getInbox(studentId: string, classId?: string) {
    const whereClause: any = {
      student_id: studentId,
      activity: {
        deleted_at: null,
        status: 'PUBLISHED',
      },
    };

    if (classId) {
      whereClause.class_id = classId;
    }

    const submissions = await this.prisma.submission.findMany({
      where: whereClause,
      include: {
        activity: {
          select: {
            id: true,
            title: true,
            description: true,
            due_date: true,
            class_id: true,
          },
        },
      },
      orderBy: {
        activity: {
          due_date: 'asc',
        },
      },
    });

    return submissions.map((submission) => ({
      ...submission,
      isOverdue:
        submission.activity.due_date &&
        new Date(submission.activity.due_date) < new Date() &&
        submission.status !== SubmissionStatus.SUBMITTED &&
        submission.status !== SubmissionStatus.APPROVED,
    }));
  }

  async findOne(submissionId: string, requesterId: string): Promise<Submission> {
    const submission = await this.prisma.submission.findUnique({
      where: { id: submissionId },
      include: {
        blocks: {
          orderBy: {
            created_at: 'asc',
          },
        },
        activity: {
          include: {
            class: {
              include: {
                teachers: {
                  where: {
                    teacher_id: requesterId,
                  },
                },
              },
            },
          },
        },
        student: {
          select: {
            id: true,
            email: true,
          },
        },
      },
    });

    if (!submission) {
      throw new NotFoundException('Submission not found');
    }

    // Check if requester is student owner or class teacher
    const isOwner = submission.student_id === requesterId;
    const isTeacher = submission.activity.class.teachers.length > 0;

    if (!isOwner && !isTeacher) {
      throw new ForbiddenException('You do not have access to this submission');
    }

    return submission;
  }

  async start(submissionId: string, studentId: string): Promise<Submission> {
    const submission = await this.prisma.submission.findUnique({
      where: { id: submissionId },
    });

    if (!submission) {
      throw new NotFoundException('Submission not found');
    }

    if (submission.student_id !== studentId) {
      throw new ForbiddenException('You do not own this submission');
    }

    if (submission.status !== SubmissionStatus.NOT_STARTED) {
      throw new BadRequestException(
        'Submission has already been started',
      );
    }

    const updated = await this.prisma.submission.update({
      where: { id: submissionId },
      data: {
        status: SubmissionStatus.IN_PROGRESS,
        started_at: new Date(),
      },
    });

    // Emit WebSocket event
    this.submissionStatusGateway.emitSubmissionUpdate(submission.activity_id, {
      submissionId: updated.id,
      studentId: updated.student_id,
      status: updated.status,
      updatedAt: updated.updated_at,
    });

    return updated;
  }

  async saveBlock(
    submissionId: string,
    studentId: string,
    dto: UpdateSubmissionBlockDto,
  ) {
    const submission = await this.prisma.submission.findUnique({
      where: { id: submissionId },
      include: {
        blocks: {
          where: {
            block_id: dto.block_id,
          },
        },
      },
    });

    if (!submission) {
      throw new NotFoundException('Submission not found');
    }

    if (submission.student_id !== studentId) {
      throw new ForbiddenException('You do not own this submission');
    }

    // Can only save blocks when IN_PROGRESS or RETURNED
    if (
      submission.status !== SubmissionStatus.IN_PROGRESS &&
      submission.status !== SubmissionStatus.RETURNED
    ) {
      throw new BadRequestException(
        'Cannot save blocks for submission in current status',
      );
    }

    const existingBlock = submission.blocks[0];

    let submissionBlock;
    if (existingBlock) {
      // Update existing block
      submissionBlock = await this.prisma.submissionBlock.update({
        where: { id: existingBlock.id },
        data: {
          response_content: dto.response_content,
        },
      });

      // Get current revision count
      const revisionCount = await this.prisma.submissionBlockRevision.count({
        where: { submission_block_id: existingBlock.id },
      });

      // Create new revision
      await this.prisma.submissionBlockRevision.create({
        data: {
          submission_block_id: existingBlock.id,
          response_content: dto.response_content,
          revision_number: revisionCount + 1,
        },
      });
    } else {
      // Create new block
      submissionBlock = await this.prisma.submissionBlock.create({
        data: {
          submission_id: submissionId,
          block_id: dto.block_id,
          response_content: dto.response_content,
        },
      });

      // Create first revision
      await this.prisma.submissionBlockRevision.create({
        data: {
          submission_block_id: submissionBlock.id,
          response_content: dto.response_content,
          revision_number: 1,
        },
      });
    }

    return submissionBlock;
  }

  async submit(submissionId: string, studentId: string): Promise<Submission> {
    const submission = await this.prisma.submission.findUnique({
      where: { id: submissionId },
    });

    if (!submission) {
      throw new NotFoundException('Submission not found');
    }

    if (submission.student_id !== studentId) {
      throw new ForbiddenException('You do not own this submission');
    }

    if (submission.status !== SubmissionStatus.IN_PROGRESS) {
      throw new BadRequestException(
        'Submission must be IN_PROGRESS to submit',
      );
    }

    // Update status to SUBMITTED
    const updated = await this.prisma.submission.update({
      where: { id: submissionId },
      data: {
        status: SubmissionStatus.SUBMITTED,
        submitted_at: new Date(),
      },
    });

    // Trigger auto-grading
    try {
      await this.autoGradeService.grade(submissionId);
    } catch (error: any) {
      this.logger.error(`Auto-grading failed for ${submissionId}: ${error.message}`);
    }

    // Emit WebSocket event
    this.submissionStatusGateway.emitSubmissionUpdate(submission.activity_id, {
      submissionId: updated.id,
      studentId: updated.student_id,
      status: updated.status,
      updatedAt: updated.updated_at,
    });

    // Send SUBMISSION_RECEIVED push notification to teacher
    const activity = await this.prisma.activity.findUnique({
      where: { id: submission.activity_id },
      include: {
        class: {
          include: {
            teachers: {
              select: {
                teacher_id: true,
              },
            },
          },
        },
      },
    });

    if (activity) {
      const teacherIds = activity.class.teachers.map((t) => t.teacher_id);
      await this.notificationsService.sendBulk(teacherIds, {
        type: NotificationType.SUBMISSION_RECEIVED,
        title: 'New Submission',
        body: `A student submitted ${activity.title}`,
        data: {
          submissionId: updated.id,
          activityId: submission.activity_id,
        },
      });
    }

    return updated;
  }

  async updateFeedback(
    submissionId: string,
    teacherId: string,
    dto: TeacherFeedbackDto,
  ): Promise<Submission> {
    // Verify teacher owns activity's class
    const submission = await this.prisma.submission.findUnique({
      where: { id: submissionId },
      include: {
        activity: {
          include: {
            class: {
              include: {
                teachers: {
                  where: {
                    teacher_id: teacherId,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!submission) {
      throw new NotFoundException('Submission not found');
    }

    if (submission.activity.class.teachers.length === 0) {
      throw new ForbiddenException(
        'You do not have access to this submission',
      );
    }

    // Validate status change
    if (
      dto.status !== SubmissionStatus.RETURNED &&
      dto.status !== SubmissionStatus.APPROVED
    ) {
      throw new BadRequestException(
        'Status must be RETURNED or APPROVED',
      );
    }

    const updateData: any = {
      status: dto.status,
      teacher_feedback_text: dto.feedback_text || null,
      teacher_feedback_audio_url: dto.feedback_audio_url || null,
    };

    if (dto.status === SubmissionStatus.RETURNED) {
      updateData.returned_at = new Date();
    } else if (dto.status === SubmissionStatus.APPROVED) {
      updateData.approved_at = new Date();
    }

    const updated = await this.prisma.submission.update({
      where: { id: submissionId },
      data: updateData,
    });

    // Emit WebSocket event
    this.submissionStatusGateway.emitSubmissionUpdate(submission.activity_id, {
      submissionId: updated.id,
      studentId: updated.student_id,
      status: updated.status,
      updatedAt: updated.updated_at,
    });

    // Auto-create journal post when submission is approved
    if (dto.status === SubmissionStatus.APPROVED) {
      try {
        await this.journalService.createPostFromSubmission(submissionId);
      } catch (error: any) {
        this.logger.error(
          `Failed to create journal post for submission ${submissionId}: ${error.message}`,
        );
        // Don't fail the feedback update if journal post creation fails
      }
    }

    // Send ACTIVITY_RETURNED push notification to student if RETURNED
    if (dto.status === SubmissionStatus.RETURNED) {
      await this.notificationsService.sendToUser(submission.student_id, {
        type: NotificationType.ACTIVITY_RETURNED,
        title: 'Activity Returned',
        body: `Your ${submission.activity.title} submission has been returned`,
        data: {
          submissionId,
          activityId: submission.activity_id,
        },
      });
    }

    return updated;
  }
}
