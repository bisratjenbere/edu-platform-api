import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { ConfigModule } from '@nestjs/config';
import { LibraryController } from './library.controller';
import { LibraryService } from './library.service';
import { ElasticsearchService } from './elasticsearch.service';
import { LibrarySyncProcessor } from './library-sync.job';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [
    PrismaModule,
    ConfigModule,
    BullModule.registerQueue({
      name: 'library-sync',
    }),
  ],
  controllers: [LibraryController],
  providers: [LibraryService, ElasticsearchService, LibrarySyncProcessor],
  exports: [LibraryService],
})
export class LibraryModule {}
