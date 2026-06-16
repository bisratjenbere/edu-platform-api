import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { FluencyService } from './fluency.service';
import { FluencyController } from './fluency.controller';
import { FluencyAnalysisJob } from './fluency-analysis.job';
import { FluencyGateway } from './fluency.gateway';
import { PrismaModule } from '../../prisma/prisma.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { UploadsModule } from '../uploads/uploads.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'fluency-analysis',
    }),
    PrismaModule,
    NotificationsModule,
    UploadsModule,
    AuthModule,
  ],
  controllers: [FluencyController],
  providers: [FluencyService, FluencyAnalysisJob, FluencyGateway],
  exports: [FluencyService],
})
export class FluencyModule {}
