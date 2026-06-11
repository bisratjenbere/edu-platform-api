import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, BadRequestException } from '@nestjs/common';
import { MessagesService } from './messages.service';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { MessagingGateway } from './messaging.gateway';
import { Role, ThreadType } from '@prisma/client';
import { Queue } from 'bull';

describe('MessagesService', () => {
  let service: MessagesService;
  let prisma: PrismaService;
  let redis: RedisService;
  let translationsQueue: Queue;
  let messagingGateway: MessagingGateway;

  const mockPrismaService = {
    user: {
      findUnique: jest.fn(),
    },
    classTeacher: {
      findFirst: jest.fn(),
    },
    classStudent: {
      findFirst: jest.fn(),
    },
    familyStudent: {
      findFirst: jest.fn(),
    },
    messageThread: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
    },
    threadParticipant: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    message: {
      create: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
  };

  const mockRedisClient = {
    incr: jest.fn(),
    get: jest.fn(),
    del: jest.fn(),
  };

  const mockRedisService = {
    getClient: jest.fn().mockReturnValue(mockRedisClient),
  };

  const mockTranslationsQueue = {
    add: jest.fn(),
  };

  const mockMessagingGateway = {
    emitNewMessage: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MessagesService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: RedisService, useValue: mockRedisService },
        { provide: 'BullQueue_translations', useValue: mockTranslationsQueue },
        { provide: MessagingGateway, useValue: mockMessagingGateway },
      ],
    }).compile();

    service = module.get<MessagesService>(MessagesService);
    prisma = module.get<PrismaService>(PrismaService);
    redis = module.get<RedisService>(RedisService);
    translationsQueue = module.get<Queue>('BullQueue_translations');
    messagingGateway = module.get<MessagingGateway>(MessagingGateway);

    // Clear all mocks before each test
    jest.clearAllMocks();
  });

  describe('createThread', () => {
    it('should create a thread when creator is a teacher in the class', async () => {
      const creatorId = 'teacher-123';
      const dto = {
        thread_type: ThreadType.DIRECT,
        class_id: 'class-123',
        recipient_ids: ['family-123'],
        allow_replies: true,
      };

      mockPrismaService.user.findUnique.mockResolvedValueOnce({
        id: creatorId,
        role: Role.TEACHER,
        deleted_at: null,
      });

      mockPrismaService.classTeacher.findFirst.mockResolvedValueOnce({
        class_id: dto.class_id,
        teacher_id: creatorId,
        deleted_at: null,
      });

      mockPrismaService.user.findUnique.mockResolvedValueOnce({
        id: 'family-123',
        role: Role.FAMILY,
        deleted_at: null,
      });

      mockPrismaService.familyStudent.findFirst.mockResolvedValueOnce({
        family_id: 'family-123',
        class_id: dto.class_id,
      });

      mockPrismaService.messageThread.create.mockResolvedValueOnce({
        id: 'thread-123',
        ...dto,
        created_by: creatorId,
        created_at: new Date(),
        updated_at: new Date(),
      });

      mockPrismaService.threadParticipant.create.mockResolvedValue({});

      const result = await service.createThread(creatorId, dto);

      expect(result.id).toBe('thread-123');
      expect(mockPrismaService.messageThread.create).toHaveBeenCalledWith({
        data: {
          class_id: dto.class_id,
          thread_type: dto.thread_type,
          created_by: creatorId,
          subject: null,
          allow_replies: true,
        },
      });
      expect(mockPrismaService.threadParticipant.create).toHaveBeenCalledTimes(
        2,
      ); // creator + 1 recipient
    });

    it('should throw ForbiddenException if creator is not a teacher', async () => {
      const creatorId = 'student-123';
      const dto = {
        thread_type: ThreadType.DIRECT,
        class_id: 'class-123',
        recipient_ids: ['family-123'],
      };

      mockPrismaService.user.findUnique.mockResolvedValueOnce({
        id: creatorId,
        role: Role.STUDENT,
        deleted_at: null,
      });

      await expect(service.createThread(creatorId, dto)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should throw ForbiddenException if creator is not a teacher in the class', async () => {
      const creatorId = 'teacher-123';
      const dto = {
        thread_type: ThreadType.DIRECT,
        class_id: 'class-123',
        recipient_ids: ['family-123'],
      };

      mockPrismaService.user.findUnique.mockResolvedValueOnce({
        id: creatorId,
        role: Role.TEACHER,
        deleted_at: null,
      });

      mockPrismaService.classTeacher.findFirst.mockResolvedValueOnce(null);

      await expect(service.createThread(creatorId, dto)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should throw BadRequestException if recipient is not part of the class', async () => {
      const creatorId = 'teacher-123';
      const dto = {
        thread_type: ThreadType.DIRECT,
        class_id: 'class-123',
        recipient_ids: ['family-123'],
      };

      mockPrismaService.user.findUnique.mockResolvedValueOnce({
        id: creatorId,
        role: Role.TEACHER,
        deleted_at: null,
      });

      mockPrismaService.classTeacher.findFirst.mockResolvedValueOnce({
        class_id: dto.class_id,
        teacher_id: creatorId,
      });

      mockPrismaService.user.findUnique.mockResolvedValueOnce({
        id: 'family-123',
        role: Role.FAMILY,
        deleted_at: null,
      });

      mockPrismaService.classStudent.findFirst.mockResolvedValueOnce(null);
      mockPrismaService.familyStudent.findFirst.mockResolvedValueOnce(null);

      await expect(service.createThread(creatorId, dto)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('sendMessage', () => {
    it('should send message and increment unread count', async () => {
      const threadId = 'thread-123';
      const senderId = 'teacher-123';
      const dto = {
        body: 'Test message',
        attachments: [],
      };

      mockPrismaService.threadParticipant.findUnique.mockResolvedValueOnce({
        thread_id: threadId,
        user_id: senderId,
        deleted_at: null,
        thread: {
          id: threadId,
          allow_replies: true,
          created_by: senderId,
        },
      });

      mockPrismaService.message.create.mockResolvedValueOnce({
        id: 'message-123',
        thread_id: threadId,
        sender_id: senderId,
        body: dto.body,
        attachments: [],
        created_at: new Date(),
      });

      mockPrismaService.threadParticipant.findMany.mockResolvedValueOnce([
        {
          thread_id: threadId,
          user_id: 'family-123',
          user: {
            id: 'family-123',
            preferred_language: 'en',
          },
        },
      ]);

      const result = await service.sendMessage(threadId, senderId, dto);

      expect(result.body).toBe('Test message');
      expect(mockRedisClient.incr).toHaveBeenCalledWith('unread:family-123');
      expect(mockMessagingGateway.emitNewMessage).toHaveBeenCalled();
    });

    it('should enqueue translation job for non-English recipients', async () => {
      const threadId = 'thread-123';
      const senderId = 'teacher-123';
      const dto = {
        body: 'Test message',
        attachments: [],
      };

      mockPrismaService.threadParticipant.findUnique.mockResolvedValueOnce({
        thread_id: threadId,
        user_id: senderId,
        deleted_at: null,
        thread: {
          id: threadId,
          allow_replies: true,
          created_by: senderId,
        },
      });

      mockPrismaService.message.create.mockResolvedValueOnce({
        id: 'message-123',
        thread_id: threadId,
        sender_id: senderId,
        body: dto.body,
        attachments: [],
        created_at: new Date(),
      });

      mockPrismaService.threadParticipant.findMany.mockResolvedValueOnce([
        {
          thread_id: threadId,
          user_id: 'family-123',
          user: {
            id: 'family-123',
            preferred_language: 'es',
          },
        },
      ]);

      await service.sendMessage(threadId, senderId, dto);

      expect(mockTranslationsQueue.add).toHaveBeenCalledWith(
        expect.stringContaining('translate-message:message-123:es'),
        {
          messageId: 'message-123',
          targetLang: 'es',
        },
        expect.objectContaining({
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 5000,
          },
        }),
      );
    });

    it('should throw ForbiddenException if sender is not a participant', async () => {
      const threadId = 'thread-123';
      const senderId = 'user-123';
      const dto = {
        body: 'Test message',
      };

      mockPrismaService.threadParticipant.findUnique.mockResolvedValueOnce(
        null,
      );

      await expect(
        service.sendMessage(threadId, senderId, dto),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw ForbiddenException if replies are disabled and sender is not creator', async () => {
      const threadId = 'thread-123';
      const senderId = 'family-123';
      const dto = {
        body: 'Test message',
      };

      mockPrismaService.threadParticipant.findUnique.mockResolvedValueOnce({
        thread_id: threadId,
        user_id: senderId,
        deleted_at: null,
        thread: {
          id: threadId,
          allow_replies: false,
          created_by: 'teacher-123', // Different from sender
        },
      });

      await expect(
        service.sendMessage(threadId, senderId, dto),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('markRead', () => {
    it('should update last_read_at and delete unread count', async () => {
      const threadId = 'thread-123';
      const userId = 'user-123';

      mockPrismaService.threadParticipant.findUnique.mockResolvedValueOnce({
        thread_id: threadId,
        user_id: userId,
        deleted_at: null,
      });

      mockPrismaService.threadParticipant.update.mockResolvedValueOnce({});

      await service.markRead(threadId, userId);

      expect(mockPrismaService.threadParticipant.update).toHaveBeenCalledWith({
        where: {
          thread_id_user_id: {
            thread_id: threadId,
            user_id: userId,
          },
        },
        data: {
          last_read_at: expect.any(Date),
        },
      });
      expect(mockRedisClient.del).toHaveBeenCalledWith(`unread:${userId}`);
    });

    it('should throw ForbiddenException if user is not a participant', async () => {
      const threadId = 'thread-123';
      const userId = 'user-123';

      mockPrismaService.threadParticipant.findUnique.mockResolvedValueOnce(
        null,
      );

      await expect(service.markRead(threadId, userId)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('getUnreadCount', () => {
    it('should return unread count from Redis', async () => {
      const userId = 'user-123';
      mockRedisClient.get.mockResolvedValueOnce('5');

      const result = await service.getUnreadCount(userId);

      expect(result).toBe(5);
      expect(mockRedisClient.get).toHaveBeenCalledWith(`unread:${userId}`);
    });

    it('should return 0 if Redis key is missing', async () => {
      const userId = 'user-123';
      mockRedisClient.get.mockResolvedValueOnce(null);

      const result = await service.getUnreadCount(userId);

      expect(result).toBe(0);
    });
  });
});
