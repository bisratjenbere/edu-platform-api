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
  ],
  controllers: [SubmissionsController],
  providers: [SubmissionsService, AutoGradeService],
  exports: [SubmissionsService, AutoGradeService],
})
export class SubmissionsModule {}
