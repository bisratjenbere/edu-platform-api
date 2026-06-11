import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { getMessaging } from 'firebase-admin/messaging';
import { PrismaService } from '../../prisma/prisma.service';

interface PushNotificationJobData {
  token: string;
  notification: {
    title: string;
    body: string;
  };
  data?: Record<string, string>;
}

@Processor('push-notifications')
export class PushNotificationJob {
  private readonly logger = new Logger(PushNotificationJob.name);

  constructor(private prisma: PrismaService) {}

  @Process('send-push')
  async handleSendPush(job: Job<PushNotificationJobData>) {
    const { token, notification, data } = job.data;

    try {
      // Send via Firebase Admin SDK
      await getMessaging().send({
        token,
        notification,
        data,
      });

      this.logger.log(`Successfully sent push notification to token ${token.substring(0, 10)}...`);
    } catch (error: any) {
      // Handle invalid/expired token
      if (
        error.code === 'messaging/registration-token-not-registered' ||
        error.code === 'messaging/invalid-registration-token'
      ) {
        this.logger.warn(
          `Token ${token.substring(0, 10)}... is invalid or expired, deleting from database`,
        );

        // Delete invalid token from database
        try {
          await this.prisma.userDevice.delete({
            where: { token },
          });
        } catch (dbError: any) {
          this.logger.error(
            `Failed to delete invalid token: ${dbError.message}`,
          );
        }

        // Don't retry - token is permanently invalid
        return;
      }

      // For other errors, let BullMQ retry mechanism handle it
      this.logger.error(
        `Failed to send push notification: ${error.message}`,
      );
      throw error; // BullMQ will retry with exponential backoff
    }
  }
}
