import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { Role, MessageThread, Message } from '@prisma/client';
import { CreateThreadDto, SendMessageDto } from './dto';
import { MessagingGateway } from './messaging.gateway';

@Injectable()
export class MessagesService {
  constructor(
    private prisma: PrismaService,
    private redisService: RedisService,
    @InjectQueue('translations') private translationsQueue: Queue,
    @Inject(forwardRef(() => MessagingGateway))
    private messagingGateway: MessagingGateway,
  ) {}

  async createThread(
    creatorId: string,
    dto: CreateThreadDto,
  ): Promise<MessageThread> {
    // Verify creator is TEACHER
    const creator = await this.prisma.user.findUnique({
      where: { id: creatorId, deleted_at: null },
    });

    if (!creator || creator.role !== Role.TEACHER) {
      throw new ForbiddenException('Only teachers can create message threads');
    }

    // Verify creator is teacher in the class
    const classTeacher = await this.prisma.classTeacher.findFirst({
      where: {
        class_id: dto.class_id,
        teacher_id: creatorId,
        deleted_at: null,
      },
    });

    if (!classTeacher) {
      throw new ForbiddenException(
        'You do not have access to create threads for this class',
      );
    }

    // Verify all recipients are valid users and are in the class (as students or family members)
    for (const recipientId of dto.recipient_ids) {
      const user = await this.prisma.user.findUnique({
        where: { id: recipientId, deleted_at: null },
      });

      if (!user) {
        throw new BadRequestException(
          `Recipient ${recipientId} not found or inactive`,
        );
      }

      // Check if recipient is a student in the class OR family member linked to a student in the class
      const isStudent = await this.prisma.classStudent.findFirst({
        where: {
          class_id: dto.class_id,
          student_id: recipientId,
          deleted_at: null,
        },
      });

      const isFamilyMember = await this.prisma.familyStudent.findFirst({
        where: {
          class_id: dto.class_id,
          family_id: recipientId,
          deleted_at: null,
        },
      });

      if (!isStudent && !isFamilyMember) {
        throw new BadRequestException(
          `Recipient ${recipientId} is not part of this class`,
        );
      }
    }

    // Create thread
    const thread = await this.prisma.messageThread.create({
      data: {
        class_id: dto.class_id,
        thread_type: dto.thread_type,
        created_by: creatorId,
        subject: dto.subject || null,
        allow_replies: dto.allow_replies ?? true,
      },
    });

    // Create ThreadParticipant for creator (teacher)
    await this.prisma.threadParticipant.create({
      data: {
        thread_id: thread.id,
        user_id: creatorId,
      },
    });

    // Create ThreadParticipant for each recipient
    await Promise.all(
      dto.recipient_ids.map((recipientId) =>
        this.prisma.threadParticipant.create({
          data: {
            thread_id: thread.id,
            user_id: recipientId,
          },
        }),
      ),
    );

    return thread;
  }

  async sendMessage(
    threadId: string,
    senderId: string,
    dto: SendMessageDto,
  ): Promise<Message> {
    // Verify sender is participant in thread and get thread details
    const participant = await this.prisma.threadParticipant.findUnique({
      where: {
        thread_id_user_id: {
          thread_id: threadId,
          user_id: senderId,
        },
        deleted_at: null,
      },
      include: {
        thread: true,
      },
    });

    if (!participant) {
      throw new ForbiddenException(
        'You are not a participant in this thread',
      );
    }

    // Get thread to check allow_replies
    const thread = await this.prisma.messageThread.findUnique({
      where: { id: threadId },
    });

    if (!thread) {
      throw new ForbiddenException('Thread not found');
    }

    // Check if thread allows replies (if sender is not the creator and allow_replies = false)
    if (!thread.allow_replies && thread.created_by !== senderId) {
      throw new ForbiddenException('Replies are disabled for this thread');
    }

    // Create message - attachments is already an array, cast to Json type
    const message = await this.prisma.message.create({
      data: {
        thread_id: threadId,
        sender_id: senderId,
        body: dto.body,
        attachments: (dto.attachments || []) as any,
      },
    });

    // Get all participants except sender
    const participants = await this.prisma.threadParticipant.findMany({
      where: {
        thread_id: threadId,
        user_id: { not: senderId },
        deleted_at: null,
      },
      include: {
        user: {
          select: {
            id: true,
            preferred_language: true,
          },
        },
      },
    });

    // Increment unread count for each participant (except sender)
    const redis = this.redisService.getClient();
    await Promise.all(
      participants.map((p) => redis.incr(`unread:${p.user_id}`)),
    );

    // Enqueue translation jobs for participants with non-English preferred language
    for (const participant of participants) {
      const targetLang = participant.user.preferred_language || 'en';
      if (targetLang !== 'en') {
        await this.translationsQueue.add(
          `translate-message:${message.id}:${targetLang}`,
          {
            messageId: message.id,
            targetLang,
          },
          {
            attempts: 3,
            backoff: {
              type: 'exponential',
              delay: 5000,
            },
            removeOnComplete: true,
            removeOnFail: false,
          },
        );
      }
    }

    // Emit new-message event to all participants via WebSocket
    const recipientIds = participants.map((p) => p.user_id);
    const unreadCount = await this.getUnreadCount(recipientIds[0]); // Get first recipient's unread (they will all query individually)
    await this.messagingGateway.emitNewMessage(recipientIds, {
      threadId,
      message,
      unreadCount,
    });

    return message;
  }

  async getThreads(
    userId: string,
    cursor?: string,
    limit: number = 20,
  ): Promise<{
    threads: any[];
    nextCursor: string | null;
    hasMore: boolean;
  }> {
    const whereClause: any = {
      participants: {
        some: {
          user_id: userId,
          deleted_at: null,
        },
      },
    };

    if (cursor) {
      whereClause.id = { lt: cursor };
    }

    const threads = await this.prisma.messageThread.findMany({
      where: whereClause,
      include: {
        messages: {
          orderBy: { created_at: 'desc' },
          take: 1,
          select: {
            id: true,
            body: true,
            created_at: true,
            sender_id: true,
            translated_bodies: true,
          },
        },
        participants: {
          where: { deleted_at: null },
          include: {
            user: {
              select: {
                id: true,
                first_name: true,
                last_name: true,
                role: true,
              },
            },
          },
        },
      },
      orderBy: { updated_at: 'desc' },
      take: limit + 1,
    });

    const hasMore = threads.length > limit;
    const items = hasMore ? threads.slice(0, limit) : threads;
    const nextCursor = hasMore ? items[items.length - 1].id : null;

    // Get unread count per thread for current user
    const threadsWithUnread = await Promise.all(
      items.map(async (thread) => {
        const participant = thread.participants.find(
          (p) => p.user_id === userId,
        );
        const lastReadAt = participant?.last_read_at;

        const unreadCount = await this.prisma.message.count({
          where: {
            thread_id: thread.id,
            created_at: lastReadAt ? { gt: lastReadAt } : undefined,
            sender_id: { not: userId },
            deleted_at: null,
          },
        });

        // Get translated body if available
        const lastMessage = thread.messages[0];
        const user = await this.prisma.user.findUnique({
          where: { id: userId },
        });
        const preferredLang = user?.preferred_language || 'en';

        let displayBody = lastMessage?.body;
        if (
          lastMessage &&
          preferredLang !== 'en' &&
          lastMessage.translated_bodies &&
          typeof lastMessage.translated_bodies === 'object'
        ) {
          const translations = lastMessage.translated_bodies as Record<
            string,
            string
          >;
          displayBody = translations[preferredLang] || lastMessage.body;
        }

        return {
          ...thread,
          messages: lastMessage
            ? [{ ...lastMessage, body: displayBody }]
            : [],
          unreadCount,
        };
      }),
    );

    return {
      threads: threadsWithUnread,
      nextCursor,
      hasMore,
    };
  }

  async getThread(
    threadId: string,
    userId: string,
    cursor?: string,
    limit: number = 50,
  ): Promise<{
    thread: MessageThread;
    messages: any[];
    nextCursor: string | null;
    hasMore: boolean;
  }> {
    // Verify user is participant
    const participant = await this.prisma.threadParticipant.findFirst({
      where: {
        thread_id: threadId,
        user_id: userId,
        deleted_at: null,
      },
    });

    if (!participant) {
      throw new ForbiddenException(
        'You are not a participant in this thread',
      );
    }

    const thread = await this.prisma.messageThread.findFirst({
      where: { id: threadId },
    });

    if (!thread) {
      throw new NotFoundException('Thread not found');
    }

    // Get messages with cursor pagination
    const whereClause: any = {
      thread_id: threadId,
      deleted_at: null,
    };

    if (cursor) {
      whereClause.id = { lt: cursor };
    }

    const messages = await this.prisma.message.findMany({
      where: whereClause,
      include: {
        sender: {
          select: {
            id: true,
            first_name: true,
            last_name: true,
            role: true,
          },
        },
      },
      orderBy: { created_at: 'desc' },
      take: limit + 1,
    });

    const hasMore = messages.length > limit;
    const items = hasMore ? messages.slice(0, limit) : messages;
    const nextCursor = hasMore ? items[items.length - 1].id : null;

    // Get user's preferred language and return translated bodies
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });
    const preferredLang = user?.preferred_language || 'en';

    const messagesWithTranslation = items.map((message) => {
      let displayBody = message.body;

      if (
        preferredLang !== 'en' &&
        message.translated_bodies &&
        typeof message.translated_bodies === 'object'
      ) {
        const translations = message.translated_bodies as Record<string, string>;
        displayBody = translations[preferredLang] || message.body;
      }

      return {
        ...message,
        body: displayBody,
      };
    });

    return {
      thread,
      messages: messagesWithTranslation,
      nextCursor,
      hasMore,
    };
  }

  async markRead(threadId: string, userId: string): Promise<void> {
    // Verify user is participant
    const participant = await this.prisma.threadParticipant.findUnique({
      where: {
        thread_id_user_id: {
          thread_id: threadId,
          user_id: userId,
        },
        deleted_at: null,
      },
    });

    if (!participant) {
      throw new ForbiddenException(
        'You are not a participant in this thread',
      );
    }

    // Update last_read_at
    await this.prisma.threadParticipant.update({
      where: {
        thread_id_user_id: {
          thread_id: threadId,
          user_id: userId,
        },
      },
      data: {
        last_read_at: new Date(),
      },
    });

    // Delete Redis unread counter (full reset per redis-key.md)
    const redis = this.redisService.getClient();
    await redis.del(`unread:${userId}`);
  }

  async getUnreadCount(userId: string): Promise<number> {
    const redis = this.redisService.getClient();
    const count = await redis.get(`unread:${userId}`);
    return count ? parseInt(count, 10) : 0;
  }
}
