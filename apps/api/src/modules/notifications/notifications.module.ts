import { Module, forwardRef } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { DevicesController } from './devices.controller';
import { PushNotificationJob } from './push-notification.job';
import { ActivityReminderJob } from './activity-reminder.job';
import { PrismaModule } from '../../prisma/prisma.module';
import { RedisModule } from '../../redis/redis.module';

@Module({
  imports: [
    PrismaModule,
    RedisModule,
    BullModule.registerQueue({
      name: 'push-notifications',
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000,
        },
        removeOnComplete: true,
        removeOnFail: false, // Keep failed jobs for inspection
      },
    }),
  ],
  providers: [
    NotificationsService,
    PushNotificationJob,
    ActivityReminderJob,
  ],
  controllers: [NotificationsController, DevicesController],
  exports: [NotificationsService],
})
export class NotificationsModule {}
