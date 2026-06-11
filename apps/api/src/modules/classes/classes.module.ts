import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PrismaModule } from '../../prisma/prisma.module';
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
