import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { JwtModule } from '@nestjs/jwt';
import { PrismaModule } from '../../prisma/prisma.module';
import { RedisModule } from '../../redis/redis.module';
import { ActivitiesController } from './activities.controller';
import { ActivitiesService } from './activities.service';
import { BlocksService } from './blocks.service';
import { ActivitySchedulerJob } from './activity-scheduler.job';
import { SubmissionStatusGateway } from './submission-status.gateway';

@Module({
  imports: [
    PrismaModule,
    RedisModule,
    JwtModule,
    BullModule.registerQueue({
      name: 'activity-scheduler',
    }),
  ],
  controllers: [ActivitiesController],
  providers: [
    ActivitiesService,
    BlocksService,
    ActivitySchedulerJob,
    SubmissionStatusGateway,
  ],
  exports: [ActivitiesService, BlocksService, SubmissionStatusGateway],
})
export class ActivitiesModule {}
