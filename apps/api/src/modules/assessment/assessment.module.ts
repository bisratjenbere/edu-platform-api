import { Module, forwardRef } from '@nestjs/common';
import { AssessmentController } from './assessment.controller';
import { AssessmentService } from './assessment.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { SubmissionsModule } from '../submissions/submissions.module';
import { JournalModule } from '../journal/journal.module';
import { ActivitiesModule } from '../activities/activities.module';

@Module({
  imports: [
    PrismaModule,
    forwardRef(() => SubmissionsModule),
    forwardRef(() => JournalModule),
    forwardRef(() => ActivitiesModule), // For SubmissionStatusGateway
  ],
  controllers: [AssessmentController],
  providers: [AssessmentService],
  exports: [AssessmentService],
})
export class AssessmentModule {}
