import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { ActivitiesModule } from '../activities/activities.module';
import { SubmissionsController } from './submissions.controller';
import { SubmissionsService } from './submissions.service';
import { AutoGradeService } from './auto-grade.service';

@Module({
  imports: [
    PrismaModule,
    ActivitiesModule,
    forwardRef(() => {
      // Lazy import to break circular dependency
      const { JournalModule } = require('../journal/journal.module');
      return JournalModule;
    }),
    forwardRef(() => {
      const { NotificationsModule } = require('../notifications/notifications.module');
      return NotificationsModule;
    }),
  ],
  controllers: [SubmissionsController],
  providers: [SubmissionsService, AutoGradeService],
  exports: [SubmissionsService, AutoGradeService],
})
export class SubmissionsModule {}
