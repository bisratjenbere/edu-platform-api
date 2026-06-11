import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { ActivitiesService } from './activities.service';

@Processor('activity-scheduler')
export class ActivitySchedulerJob {
  private readonly logger = new Logger(ActivitySchedulerJob.name);

  constructor(private activitiesService: ActivitiesService) {}

  @Process()
  async process(job: Job<{ activityId: string; teacherId: string }>) {
    const { activityId, teacherId } = job.data;

    this.logger.log(
      `Processing scheduled publish for activity ${activityId}`,
    );

    try {
      await this.activitiesService.publish(activityId, teacherId);
      this.logger.log(
        `Successfully published activity ${activityId} via scheduler`,
      );
    } catch (error: any) {
      this.logger.error(
        `Failed to publish activity ${activityId}: ${error.message}`,
      );

      // If already published, consider it success
      if (error.message?.includes('Already published')) {
        this.logger.log(`Activity ${activityId} was already published`);
        return;
      }

      // For other errors, throw to trigger retry
      throw error;
    }
  }
}
