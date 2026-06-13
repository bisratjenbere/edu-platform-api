import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { RedisModule } from '../../redis/redis.module';
import { ClassesController } from './classes.controller';
import { ClassesService } from './classes.service';
import { ClassCodeService } from './class-code.service';
import { FamilyInviteService } from './family-invite.service';
import { RosterImportService } from './roster-import.service';

@Module({
  imports: [
    ConfigModule,
    JwtModule.register({}),
    PrismaModule,
    RedisModule,
    AuthModule,
    forwardRef(() => {
      const { NotificationsModule } = require('../notifications/notifications.module');
      return NotificationsModule;
    }),
  ],
  controllers: [ClassesController],
  providers: [
    ClassesService,
    ClassCodeService,
    FamilyInviteService,
    RosterImportService,
  ],
  exports: [ClassesService],
})
export class ClassesModule {}
