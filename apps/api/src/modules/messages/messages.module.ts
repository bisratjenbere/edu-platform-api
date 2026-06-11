import { Module, forwardRef } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { JwtModule } from '@nestjs/jwt';
import { MessagesController } from './messages.controller';
import { MessagesService } from './messages.service';
import { MessagingGateway } from './messaging.gateway';
import { TranslationProcessor } from './translation.job';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisModule } from '../../redis/redis.module';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'translations',
    }),
    JwtModule.register({
      secret: process.env.JWT_SECRET,
      signOptions: { expiresIn: '15m' },
    }),
    RedisModule,
  ],
  controllers: [MessagesController],
  providers: [
    MessagesService,
    MessagingGateway,
    TranslationProcessor,
    PrismaService,
  ],
  exports: [MessagesService, MessagingGateway],
})
export class MessagesModule {}
