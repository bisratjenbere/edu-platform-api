import { Injectable, Logger, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { RegisterDeviceDto, UpdatePreferencesDto } from './dto';
import { NotificationType } from '@prisma/client';

interface NotificationPayload {
  type: NotificationType;
  title: string;
  body: string;
  data?: Record<string, string>;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
    @InjectQueue('push-notifications') private pushQueue: Queue,
  ) {}

  /**
   * Send push notification to a single user (all their registered devices)
   */
  async sendToUser(userId: string, payload: NotificationPayload): Promise<void> {
    try {
      // Check if user has this notification type enabled
      const preference = await this.prisma.notificationPreference.findUnique({
        where: {
          user_id_notification_type: {
            user_id: userId,
            notification_type: payload.type,
          },
        },
      });

      // If preference exists and is disabled, don't send
      if (preference && !preference.enabled) {
        this.logger.debug(
          `User ${userId} has disabled ${payload.type} notifications`,
        );
        return;
      }

      // Look up all registered devices for this user
      const devices = await this.prisma.userDevice.findMany({
        where: { user_id: userId },
      });

      if (devices.length === 0) {
        this.logger.debug(`No devices registered for user ${userId}`);
        return;
      }

      // Enqueue one job per device
      const jobs = devices.map((device) =>
        this.pushQueue.add('send-push', {
          token: device.token,
          notification: {
            title: payload.title,
            body: payload.body,
          },
          data: payload.data || {},
        }),
      );

      await Promise.all(jobs);
      this.logger.log(
        `Enqueued ${jobs.length} push notification(s) for user ${userId}`,
      );
    } catch (error: any) {
      this.logger.error(
        `Failed to send notification to user ${userId}: ${error.message}`,
      );
      // Don't throw - notification failures shouldn't break the main flow
    }
  }

  /**
   * Send push notification to multiple users in parallel
   */
  async sendBulk(
    userIds: string[],
    payload: NotificationPayload,
  ): Promise<void> {
    await Promise.all(userIds.map((userId) => this.sendToUser(userId, payload)));
  }

  /**
   * Schedule activity due date reminder (24h before due_date)
   */
  async scheduleReminder(
    activityId: string,
    dueDate: Date,
    classId: string,
  ): Promise<void> {
    const now = new Date();
    const reminderTime = new Date(dueDate.getTime() - 24 * 60 * 60 * 1000); // 24h before

    if (reminderTime <= now) {
      this.logger.debug(
        `Activity ${activityId} due date is less than 24h away, skipping reminder`,
      );
      return;
    }

    const delay = reminderTime.getTime() - now.getTime();

    // Enqueue delayed job
    const job = await this.pushQueue.add(
      `remind-activity:${activityId}`,
      {
        activityId,
        classId,
      },
      {
        delay,
      },
    );

    // Store job ID in Redis for cancellation support
    await this.redis.set(`notif_job:${activityId}`, job.id.toString(), 'EX', Math.ceil(delay / 1000) + 3600); // TTL = delay + 1h buffer

    this.logger.log(
      `Scheduled reminder for activity ${activityId} at ${reminderTime.toISOString()}`,
    );
  }

  /**
   * Cancel scheduled activity reminder
   */
  async cancelReminder(activityId: string): Promise<void> {
    try {
      const jobId = await this.redis.get(`notif_job:${activityId}`);

      if (!jobId) {
        this.logger.debug(`No reminder job found for activity ${activityId}`);
        return;
      }

      // Remove job from Bull queue
      const job = await this.pushQueue.getJob(jobId);
      if (job) {
        await job.remove();
        this.logger.log(`Cancelled reminder for activity ${activityId}`);
      }

      // Delete Redis key
      await this.redis.del(`notif_job:${activityId}`);
    } catch (error: any) {
      this.logger.error(
        `Failed to cancel reminder for activity ${activityId}: ${error.message}`,
      );
    }
  }

  /**
   * Register or update device token
   */
  async registerDevice(
    userId: string,
    dto: RegisterDeviceDto,
  ): Promise<void> {
    await this.prisma.userDevice.upsert({
      where: { token: dto.token },
      update: {
        last_seen_at: new Date(),
        platform: dto.platform,
      },
      create: {
        user_id: userId,
        token: dto.token,
        platform: dto.platform,
      },
    });

    this.logger.log(`Registered device for user ${userId}`);
  }

  /**
   * Unregister device token
   */
  async unregisterDevice(userId: string, token: string): Promise<void> {
    const device = await this.prisma.userDevice.findUnique({
      where: { token },
    });

    if (!device) {
      throw new NotFoundException('Device not found');
    }

    if (device.user_id !== userId) {
      throw new ForbiddenException('You do not own this device');
    }

    await this.prisma.userDevice.delete({
      where: { token },
    });

    this.logger.log(`Unregistered device ${token} for user ${userId}`);
  }

  /**
   * Get user's notification preferences (with defaults for missing types)
   */
  async getPreferences(userId: string) {
    const existingPreferences = await this.prisma.notificationPreference.findMany({
      where: { user_id: userId },
    });

    // All possible notification types
    const allTypes = Object.values(NotificationType);

    // Create map of existing preferences
    const prefMap = new Map(
      existingPreferences.map((p) => [p.notification_type, p.enabled]),
    );

    // Fill in defaults (true) for missing types
    const preferences = allTypes.map((type) => ({
      type,
      enabled: prefMap.has(type) ? prefMap.get(type)! : true, // Default to enabled
    }));

    return preferences;
  }

  /**
   * Update notification preferences (bulk upsert)
   */
  async updatePreferences(
    userId: string,
    dto: UpdatePreferencesDto,
  ): Promise<void> {
    // Upsert each preference
    await Promise.all(
      dto.preferences.map((pref) =>
        this.prisma.notificationPreference.upsert({
          where: {
            user_id_notification_type: {
              user_id: userId,
              notification_type: pref.type,
            },
          },
          update: {
            enabled: pref.enabled,
          },
          create: {
            user_id: userId,
            notification_type: pref.type,
            enabled: pref.enabled,
          },
        }),
      ),
    );

    this.logger.log(`Updated preferences for user ${userId}`);
  }
}
