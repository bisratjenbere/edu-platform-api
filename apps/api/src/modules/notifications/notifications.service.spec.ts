import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bull';
import { NotFoundException, ForbiddenException } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { NotificationType } from '@prisma/client';

describe('NotificationsService', () => {
  let service: NotificationsService;
  let prisma: any;
  let redis: any;
  let pushQueue: any;

  beforeEach(async () => {
    const mockPrisma = {
      notificationPreference: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        upsert: jest.fn(),
      },
      userDevice: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        upsert: jest.fn(),
        delete: jest.fn(),
      },
    };

    const mockRedis = {
      set: jest.fn(),
      get: jest.fn(),
      del: jest.fn(),
    };

    const mockQueue = {
      add: jest.fn().mockResolvedValue({ id: 'job-123' }),
      getJob: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        {
          provide: PrismaService,
          useValue: mockPrisma,
        },
        {
          provide: RedisService,
          useValue: mockRedis,
        },
        {
          provide: getQueueToken('push-notifications'),
          useValue: mockQueue,
        },
      ],
    }).compile();

    service = module.get<NotificationsService>(NotificationsService);
    prisma = module.get(PrismaService);
    redis = module.get(RedisService);
    pushQueue = module.get(getQueueToken('push-notifications'));
  });

  describe('sendToUser', () => {
    it('should enqueue push notifications for all user devices', async () => {
      const userId = 'user-123';
      const payload = {
        type: NotificationType.NEW_ACTIVITY,
        title: 'New Activity',
        body: 'Check out the new activity',
        data: { activityId: 'act-123' },
      };

      prisma.notificationPreference.findUnique.mockResolvedValue(null);
      prisma.userDevice.findMany.mockResolvedValue([
        {
          id: 'dev-1',
          user_id: userId,
          token: 'token-1',
          platform: 'IOS',
          created_at: new Date(),
          last_seen_at: new Date(),
        },
        {
          id: 'dev-2',
          user_id: userId,
          token: 'token-2',
          platform: 'ANDROID',
          created_at: new Date(),
          last_seen_at: new Date(),
        },
      ] as any);

      await service.sendToUser(userId, payload);

      expect(pushQueue.add).toHaveBeenCalledTimes(2);
      expect(pushQueue.add).toHaveBeenCalledWith('send-push', {
        token: 'token-1',
        notification: { title: 'New Activity', body: 'Check out the new activity' },
        data: { activityId: 'act-123' },
      });
    });

    it('should not send if user has disabled the notification type', async () => {
      const userId = 'user-123';
      const payload = {
        type: NotificationType.NEW_ACTIVITY,
        title: 'New Activity',
        body: 'Test',
      };

      prisma.notificationPreference.findUnique.mockResolvedValue({
        id: 'pref-1',
        user_id: userId,
        notification_type: NotificationType.NEW_ACTIVITY,
        enabled: false,
      });

      await service.sendToUser(userId, payload);

      expect(pushQueue.add).not.toHaveBeenCalled();
    });

    it('should handle user with no devices gracefully', async () => {
      const userId = 'user-123';
      const payload = {
        type: NotificationType.NEW_ACTIVITY,
        title: 'Test',
        body: 'Test',
      };

      prisma.notificationPreference.findUnique.mockResolvedValue(null);
      prisma.userDevice.findMany.mockResolvedValue([]);

      await service.sendToUser(userId, payload);

      expect(pushQueue.add).not.toHaveBeenCalled();
    });
  });

  describe('scheduleReminder', () => {
    it('should enqueue delayed job and store job ID in Redis', async () => {
      const activityId = 'act-123';
      const classId = 'class-123';
      const dueDate = new Date(Date.now() + 48 * 60 * 60 * 1000); // 48 hours from now

      await service.scheduleReminder(activityId, dueDate, classId);

      expect(pushQueue.add).toHaveBeenCalledWith(
        `remind-activity:${activityId}`,
        { activityId, classId },
        expect.objectContaining({ delay: expect.any(Number) }),
      );
      expect(redis.set).toHaveBeenCalledWith(
        `notif_job:${activityId}`,
        'job-123',
        'EX',
        expect.any(Number),
      );
    });

    it('should not schedule if due date is less than 24h away', async () => {
      const activityId = 'act-123';
      const classId = 'class-123';
      const dueDate = new Date(Date.now() + 12 * 60 * 60 * 1000); // 12 hours from now

      await service.scheduleReminder(activityId, dueDate, classId);

      expect(pushQueue.add).not.toHaveBeenCalled();
      expect(redis.set).not.toHaveBeenCalled();
    });
  });

  describe('cancelReminder', () => {
    it('should remove job from queue and delete Redis key', async () => {
      const activityId = 'act-123';
      const mockJob = { remove: jest.fn().mockResolvedValue(undefined) };

      redis.get.mockResolvedValue('job-123');
      pushQueue.getJob.mockResolvedValue(mockJob);

      await service.cancelReminder(activityId);

      expect(redis.get).toHaveBeenCalledWith(`notif_job:${activityId}`);
      expect(pushQueue.getJob).toHaveBeenCalledWith('job-123');
      expect(mockJob.remove).toHaveBeenCalled();
      expect(redis.del).toHaveBeenCalledWith(`notif_job:${activityId}`);
    });

    it('should handle missing job ID gracefully', async () => {
      const activityId = 'act-123';

      redis.get.mockResolvedValue(null);

      await service.cancelReminder(activityId);

      expect(pushQueue.getJob).not.toHaveBeenCalled();
    });
  });

  describe('registerDevice', () => {
    it('should upsert device token', async () => {
      const userId = 'user-123';
      const dto = { token: 'fcm-token-123', platform: 'IOS' as const };

      prisma.userDevice.upsert.mockResolvedValue({
        id: 'dev-1',
        user_id: userId,
        token: dto.token,
        platform: dto.platform,
        created_at: new Date(),
        last_seen_at: new Date(),
      } as any);

      await service.registerDevice(userId, dto);

      expect(prisma.userDevice.upsert).toHaveBeenCalledWith({
        where: { token: dto.token },
        update: {
          last_seen_at: expect.any(Date),
          platform: dto.platform,
        },
        create: {
          user_id: userId,
          token: dto.token,
          platform: dto.platform,
        },
      });
    });
  });

  describe('unregisterDevice', () => {
    it('should delete device if user owns it', async () => {
      const userId = 'user-123';
      const token = 'fcm-token-123';

      prisma.userDevice.findUnique.mockResolvedValue({
        id: 'dev-1',
        user_id: userId,
        token,
        platform: 'IOS',
        created_at: new Date(),
        last_seen_at: new Date(),
      } as any);

      await service.unregisterDevice(userId, token);

      expect(prisma.userDevice.delete).toHaveBeenCalledWith({ where: { token } });
    });

    it('should throw NotFoundException if device not found', async () => {
      const userId = 'user-123';
      const token = 'fcm-token-123';

      prisma.userDevice.findUnique.mockResolvedValue(null);

      await expect(service.unregisterDevice(userId, token)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw ForbiddenException if user does not own device', async () => {
      const userId = 'user-123';
      const token = 'fcm-token-123';

      prisma.userDevice.findUnique.mockResolvedValue({
        id: 'dev-1',
        user_id: 'different-user',
        token,
        platform: 'IOS',
        created_at: new Date(),
        last_seen_at: new Date(),
      } as any);

      await expect(service.unregisterDevice(userId, token)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('getPreferences', () => {
    it('should return all notification types with defaults for missing types', async () => {
      const userId = 'user-123';

      prisma.notificationPreference.findMany.mockResolvedValue([
        {
          id: 'pref-1',
          user_id: userId,
          notification_type: NotificationType.NEW_ACTIVITY,
          enabled: false,
        },
      ] as any);

      const result = await service.getPreferences(userId);

      expect(result.length).toBe(Object.keys(NotificationType).length);
      expect(result.find((p) => p.type === NotificationType.NEW_ACTIVITY)?.enabled).toBe(
        false,
      );
      expect(
        result.find((p) => p.type === NotificationType.SUBMISSION_RECEIVED)?.enabled,
      ).toBe(true);
    });
  });
});
