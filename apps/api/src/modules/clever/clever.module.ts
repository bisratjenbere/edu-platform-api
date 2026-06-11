import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { CleverController } from './clever.controller';
import { CleverService } from './clever.service';
import { CleverStrategy } from './clever.strategy';
import { CleverApiService } from './clever-api.service';
import { CleverRosterSyncService } from './clever-roster-sync.service';
import { CleverRosterSyncJob } from './clever-roster-sync.job';
import { PrismaModule } from '../../prisma/prisma.module';
import { RedisModule } from '../../redis/redis.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'clever-roster-sync',
    }),
    PrismaModule,
    RedisModule,
    AuthModule,
  ],
  controllers: [CleverController],
  providers: [
    CleverService,
    CleverStrategy,
    CleverApiService,
    CleverRosterSyncService,
    CleverRosterSyncJob,
  ],
  exports: [CleverService, CleverApiService, CleverRosterSyncService],
})
export class CleverModule {}
