import { Process, Processor } from '@nestjs/bull';
import { Logger, Inject, forwardRef } from '@nestjs/common';
import { Job } from 'bull';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { NotificationsService } from './notifications.service';
import { NotificationType } from '@prisma/client';

interface ActivityReminderJobData {
  activityId: string;
  classId: string;
}

@Processor('push-notifications')
export class ActivityReminderJob {
  private readonly logger = new Logger(ActivityReminderJob.name);

  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
    @Inject(forwardRef(() => NotificationsService))
    private notificationsService: NotificationsService,
  ) {}

  @Process('*')
  async handleActivityReminder(job: Job<ActivityReminderJobData>) {
    // Only process jobs that match the remind-activity pattern
    if (!job.name.startsWith('remind-activity:')) {
      return;
    }

    const { activityId, classId } = job.data;

    try {
      // Get activity details
      const activity = await this.prisma.activity.findUnique({
        where: { id: activityId, deleted_at: null },
        select: {
          id: true,
          title: true,
          due_date: true,
          assigned_to: true,
        },
      });

      if (!activity || !activity.due_date) {
        this.logger.warn(
          `Activity ${activityId} not found or has no due date, skipping reminder`,
        );
        await this.redis.del(`notif_job:${activityId}`);
        return;
      }

      // Find students who haven't started the activity yet
      const submissions = await this.prisma.submission.findMany({
        where: {
          activity_id: activityId,
          status: 'NOT_STARTED',
        },
        select: {
          student_id: true,
        },
      });

      const studentIds = submissions.map((s) => s.student_id);

      if (studentIds.length === 0) {
        this.logger.log(
          `No students need reminder for activity ${activityId}`,
        );
        await this.redis.del(`notif_job:${activityId}`);
        return;
      }

      // Send bulk notification
      await this.notificationsService.sendBulk(studentIds, {
        type: NotificationType.ACTIVITY_DUE_REMINDER,
        title: 'Activity Due Soon! ⏰',
        body: `"${activity.title}" is due in 24 hours`,
        data: {
          activityId: activity.id,
          classId,
        },
      });

      this.logger.log(
        `Sent activity due reminder to ${studentIds.length} student(s) for activity ${activityId}`,
      );

      // Clean up Redis key
      await this.redis.del(`notif_job:${activityId}`);
    } catch (error: any) {
      this.logger.error(
        `Failed to send activity reminder for ${activityId}: ${error.message}`,
      );
      throw error; // Let BullMQ retry
    }
  }
}
