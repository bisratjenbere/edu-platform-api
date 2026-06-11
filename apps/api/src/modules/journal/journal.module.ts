import { Module, forwardRef } from '@nestjs/common';
import { JournalController } from './journal.controller';
import { JournalService } from './journal.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { SubmissionsModule } from '../submissions/submissions.module';

@Module({
  imports: [PrismaModule, forwardRef(() => SubmissionsModule)],
  controllers: [JournalController],
  providers: [JournalService],
  exports: [JournalService],
})
export class JournalModule {}
