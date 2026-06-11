import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import {
  ActivityStatus,
  AssignedTo,
  CoTeacherRole,
  Activity,
  NotificationType,
} from '@prisma/client';
import { CreateActivityDto, UpdateActivityDto } from './dto';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class ActivitiesService {
  constructor(
    private prisma: PrismaService,
    private redisService: RedisService,
    @InjectQueue('activity-scheduler') private schedulerQueue: Queue,
    @Inject(forwardRef(() => NotificationsService))
    private readonly notificationsService: NotificationsService,
  ) {}

  async create(teacherId: string, dto: CreateActivityDto): Promise<Activity> {
    // Verify teacher owns the class
    const classTeacher = await this.prisma.classTeacher.findFirst({
      where: {
        class_id: dto.class_id,
        teacher_id: teacherId,
      },
    });

    if (!classTeacher) {
      throw new ForbiddenException(
        'You do not have permission to create activities for this class',
      );
    }

    // Create activity as DRAFT
    const activity = await this.prisma.activity.create({
      data: {
        title: dto.title,
        description: dto.description,
        class_id: dto.class_id,
        created_by: teacherId,
        status: ActivityStatus.DRAFT,
        due_date: dto.due_date ? new Date(dto.due_date) : null,
        scheduled_publish_at: dto.scheduled_publish_at
          ? new Date(dto.scheduled_publish_at)
          : null,
        assigned_to: dto.assigned_to || AssignedTo.WHOLE_CLASS,
      },
    });

    // If scheduled_publish_at is set, create delayed job
    if (activity.scheduled_publish_at) {
      await this.schedulePublish(
        activity.id,
        teacherId,
        activity.scheduled_publish_at,
      );
    }

    return activity;
  }

  async findAll(
    teacherId: string,
    classId: string,
    status?: ActivityStatus,
  ): Promise<Activity[]> {
    // Verify teacher has access to this class
    const classTeacher = await this.prisma.classTeacher.findFirst({
      where: {
        class_id: classId,
        teacher_id: teacherId,
      },
    });

    if (!classTeacher) {
      throw new ForbiddenException('You do not have access to this class');
    }

    const whereClause: any = {
      class_id: classId,
      deleted_at: null,
    };

    if (status) {
      whereClause.status = status;
    }

    return this.prisma.activity.findMany({
      where: whereClause,
      include: {
        _count: {
          select: {
            submissions: true,
          },
        },
      },
      orderBy: {
        created_at: 'desc',
      },
    });
  }

  async findOne(activityId: string, requesterId: string): Promise<Activity> {
    const activity = await this.prisma.activity.findFirst({
      where: {
        id: activityId,
        deleted_at: null,
      },
      include: {
        blocks: {
          orderBy: {
            order: 'asc',
          },
        },
        class: {
          include: {
            teachers: {
              where: {
                teacher_id: requesterId,
              },
            },
            students: {
              where: {
                student_id: requesterId,
              },
            },
          },
        },
      },
    });

    if (!activity) {
      throw new NotFoundException('Activity not found');
    }

    // Check if requester has access (teacher or student assigned)
    const hasAccess =
      activity.class.teachers.length > 0 ||
      activity.class.students.length > 0;

    if (!hasAccess) {
      throw new ForbiddenException('You do not have access to this activity');
    }

    return activity;
  }

  async update(
    activityId: string,
    teacherId: string,
    dto: UpdateActivityDto,
  ): Promise<Activity> {
    // Verify teacher ownership
    const activity = await this.prisma.activity.findFirst({
      where: {
        id: activityId,
        deleted_at: null,
      },
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
    });

    if (!activity) {
      throw new NotFoundException('Activity not found');
    }

    if (activity.class.teachers.length === 0) {
      throw new ForbiddenException('You do not have access to this activity');
    }

    const updateData: any = {};

    if (dto.title !== undefined) updateData.title = dto.title;
    if (dto.description !== undefined) updateData.description = dto.description;
    if (dto.due_date !== undefined)
      updateData.due_date = dto.due_date ? new Date(dto.due_date) : null;
    if (dto.assigned_to !== undefined) updateData.assigned_to = dto.assigned_to;

    // Handle scheduled_publish_at changes
    if (dto.scheduled_publish_at !== undefined) {
      const newScheduledAt = dto.scheduled_publish_at
        ? new Date(dto.scheduled_publish_at)
        : null;
      updateData.scheduled_publish_at = newScheduledAt;

      if (newScheduledAt) {
        await this.schedulePublish(activityId, teacherId, newScheduledAt);
      } else {
        await this.cancelScheduledPublish(activityId);
      }
    }

    return this.prisma.activity.update({
      where: { id: activityId },
      data: updateData,
    });
  }

  async softDelete(activityId: string, teacherId: string): Promise<void> {
    // Verify teacher is PRIMARY teacher
    const activity = await this.prisma.activity.findFirst({
      where: {
        id: activityId,
        deleted_at: null,
      },
      include: {
        class: {
          include: {
            teachers: {
              where: {
                teacher_id: teacherId,
                role: CoTeacherRole.PRIMARY,
              },
            },
          },
        },
      },
    });

    if (!activity) {
      throw new NotFoundException('Activity not found');
    }

    if (activity.class.teachers.length === 0) {
      throw new ForbiddenException(
        'Only the primary teacher can delete activities',
      );
    }

    // Cancel scheduled publish if exists
    await this.cancelScheduledPublish(activityId);

    // Soft delete
    await this.prisma.activity.update({
      where: { id: activityId },
      data: { deleted_at: new Date() },
    });
  }

  async publish(activityId: string, teacherId: string): Promise<Activity> {
    const activity = await this.prisma.activity.findFirst({
      where: {
        id: activityId,
        deleted_at: null,
      },
      include: {
        blocks: true,
        class: {
          include: {
            teachers: {
              where: {
                teacher_id: teacherId,
              },
            },
            students: {
              where: {
                is_active: true,
              },
            },
          },
        },
      },
    });

    if (!activity) {
      throw new NotFoundException('Activity not found');
    }

    if (activity.class.teachers.length === 0) {
      throw new ForbiddenException('You do not have access to this activity');
    }

    if (activity.status === ActivityStatus.PUBLISHED) {
      // Already published — handle gracefully for scheduled jobs
      return activity;
    }

    // Validate: all required blocks must have non-empty content
    const requiredBlocks = activity.blocks.filter((b) => b.is_required);
    for (const block of requiredBlocks) {
      if (
        !block.content ||
        Object.keys(block.content).length === 0 ||
        (typeof block.content === 'object' &&
          Object.values(block.content).every(
            (v) => v === null || v === undefined || v === '',
          ))
      ) {
        throw new BadRequestException(
          `Required block at order ${block.order} has missing content`,
        );
      }
    }

    // Update status to PUBLISHED
    const updatedActivity = await this.prisma.activity.update({
      where: { id: activityId },
      data: { status: ActivityStatus.PUBLISHED },
    });

    // Create ActivityAssignment for each student in class (or specific students if INDIVIDUAL)
    if (activity.assigned_to === AssignedTo.WHOLE_CLASS) {
      const students = activity.class.students;
      await Promise.all(
        students.map((student) =>
          this.prisma.activityAssignment.create({
            data: {
              activity_id: activityId,
              student_id: student.student_id,
            },
          }),
        ),
      );

      // Send NEW_ACTIVITY push notification to each student
      const studentIds = students.map((s) => s.student_id);
      await this.notificationsService.sendBulk(studentIds, {
        type: NotificationType.NEW_ACTIVITY,
        title: 'New Activity',
        body: `${activity.title} has been assigned`,
        data: {
          activityId: activity.id,
          classId: activity.class_id,
        },
      });
    }

    return updatedActivity;
  }

  async duplicate(
    activityId: string,
    teacherId: string,
    targetClassId: string,
  ): Promise<Activity> {
    // Verify source activity exists and teacher has access
    const sourceActivity = await this.prisma.activity.findFirst({
      where: {
        id: activityId,
        deleted_at: null,
      },
      include: {
        blocks: {
          orderBy: {
            order: 'asc',
          },
        },
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
    });

    if (!sourceActivity) {
      throw new NotFoundException('Source activity not found');
    }

    if (sourceActivity.class.teachers.length === 0) {
      throw new ForbiddenException(
        'You do not have access to the source activity',
      );
    }

    // Verify teacher has access to target class
    const targetClassTeacher = await this.prisma.classTeacher.findFirst({
      where: {
        class_id: targetClassId,
        teacher_id: teacherId,
      },
    });

    if (!targetClassTeacher) {
      throw new ForbiddenException(
        'You do not have access to the target class',
      );
    }

    // Create new activity as DRAFT
    const newActivity = await this.prisma.activity.create({
      data: {
        title: `${sourceActivity.title} (Copy)`,
        description: sourceActivity.description,
        class_id: targetClassId,
        created_by: teacherId,
        status: ActivityStatus.DRAFT,
        assigned_to: sourceActivity.assigned_to,
        standards_tags: sourceActivity.standards_tags,
        subject_tag: sourceActivity.subject_tag,
        grade_level_tag: sourceActivity.grade_level_tag,
      },
    });

    // Deep copy all blocks
    await Promise.all(
      sourceActivity.blocks.map((block) =>
        this.prisma.activityBlock.create({
          data: {
            activity_id: newActivity.id,
            type: block.type,
            content: block.content as any,
            order: block.order,
            is_required: block.is_required,
          },
        }),
      ),
    );

    return this.prisma.activity.findUnique({
      where: { id: newActivity.id },
      include: {
        blocks: {
          orderBy: {
            order: 'asc',
          },
        },
      },
    }) as Promise<Activity>;
  }

  async schedulePublish(
    activityId: string,
    teacherId: string,
    scheduledAt: Date,
  ): Promise<void> {
    const redis = this.redisService.getClient();
    const jobKey = `notif_job:${activityId}`;

    // Cancel existing job if any
    const existingJobId = await redis.get(jobKey);
    if (existingJobId) {
      try {
        const existingJob = await this.schedulerQueue.getJob(existingJobId);
        if (existingJob) {
          await existingJob.remove();
        }
      } catch (error) {
        // Job may not exist — ignore
      }
    }

    // Create new delayed job
    const delay = scheduledAt.getTime() - Date.now();
    if (delay < 0) {
      throw new BadRequestException('Scheduled publish time must be in the future');
    }

    const job = await this.schedulerQueue.add(
      `publish-activity:${activityId}`,
      { activityId, teacherId },
      {
        delay,
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000,
        },
        removeOnComplete: true,
        removeOnFail: false,
      },
    );

    // Store job id in Redis
    await redis.set(jobKey, job.id as string, 'PX', delay + 90000); // TTL = delay + 25 hours buffer
  }

  async cancelScheduledPublish(activityId: string): Promise<void> {
    const redis = this.redisService.getClient();
    const jobKey = `notif_job:${activityId}`;

    const jobId = await redis.get(jobKey);
    if (!jobId) {
      return; // No scheduled job — no-op
    }

    try {
      const job = await this.schedulerQueue.getJob(jobId);
      if (job) {
        await job.remove();
      }
    } catch (error) {
      // Job may not exist — ignore
    } finally {
      await redis.del(jobKey);
    }
  }

  async assignIndividual(
    activityId: string,
    teacherId: string,
    studentIds: string[],
    customInstructions?: Record<string, string>,
  ): Promise<void> {
    // Verify teacher ownership
    const activity = await this.prisma.activity.findFirst({
      where: {
        id: activityId,
        deleted_at: null,
      },
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
    });

    if (!activity) {
      throw new NotFoundException('Activity not found');
    }

    if (activity.class.teachers.length === 0) {
      throw new ForbiddenException('You do not have access to this activity');
    }

    if (activity.assigned_to !== AssignedTo.INDIVIDUAL) {
      throw new BadRequestException(
        'Activity must have assigned_to=INDIVIDUAL to assign to specific students',
      );
    }

    // Create assignments
    await Promise.all(
      studentIds.map((studentId) =>
        this.prisma.activityAssignment.upsert({
          where: {
            activity_id_student_id: {
              activity_id: activityId,
              student_id: studentId,
            },
          },
          create: {
            activity_id: activityId,
            student_id: studentId,
            custom_instructions: customInstructions?.[studentId] || null,
          },
          update: {
            custom_instructions: customInstructions?.[studentId] || null,
          },
        }),
      ),
    );
  }

  async getSubmissionStatus(activityId: string, teacherId: string) {
    // Verify teacher ownership
    const activity = await this.prisma.activity.findFirst({
      where: {
        id: activityId,
        deleted_at: null,
      },
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
        submissions: {
          include: {
            student: {
              select: {
                id: true,
                first_name: true,
                last_name: true,
              },
            },
          },
        },
      },
    });

    if (!activity) {
      throw new NotFoundException('Activity not found');
    }

    if (activity.class.teachers.length === 0) {
      throw new ForbiddenException('You do not have access to this activity');
    }

    return activity.submissions.map((submission) => ({
      submissionId: submission.id,
      studentId: submission.student_id,
      studentName: `${submission.student.first_name} ${submission.student.last_name}`,
      status: submission.status,
      updatedAt: submission.updated_at,
    }));
  }
}
