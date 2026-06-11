import { Test, TestingModule } from '@nestjs/testing';
import { LibraryService } from './library.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ElasticsearchService } from './elasticsearch.service';
import { Queue } from 'bull';
import { getQueueToken } from '@nestjs/bull';
import {
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { ActivityStatus, Role } from '@prisma/client';

describe('LibraryService', () => {
  let service: LibraryService;
  let prisma: PrismaService;
  let elasticsearch: ElasticsearchService;
  let queue: Queue;

  const mockPrismaService = {
    activityTemplate: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    activity: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    activityBlock: {
      create: jest.fn(),
    },
    classTeacher: {
      findFirst: jest.fn(),
    },
    templateRating: {
      upsert: jest.fn(),
      aggregate: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
  };

  const mockElasticsearchService = {
    searchTemplates: jest.fn(),
    indexTemplate: jest.fn(),
    deleteTemplate: jest.fn(),
  };

  const mockQueue = {
    add: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LibraryService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
        {
          provide: ElasticsearchService,
          useValue: mockElasticsearchService,
        },
        {
          provide: getQueueToken('library-sync'),
          useValue: mockQueue,
        },
      ],
    }).compile();

    service = module.get<LibraryService>(LibraryService);
    prisma = module.get<PrismaService>(PrismaService);
    elasticsearch = module.get<ElasticsearchService>(ElasticsearchService);
    queue = module.get<Queue>(getQueueToken('library-sync'));
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('search', () => {
    it('should call ElasticsearchService.searchTemplates with correct parameters', async () => {
      const mockResults = {
        results: [],
        total: 0,
        page: 1,
        limit: 20,
      };
      mockElasticsearchService.searchTemplates.mockResolvedValue(mockResults);

      const dto = {
        q: 'math',
        grade: 'K',
        subject: 'Mathematics',
        standard: ['CCSS.MATH.K.CC'],
        sortBy: 'relevance' as const,
        page: 1,
        limit: 20,
      };

      const result = await service.search(dto);

      expect(elasticsearch.searchTemplates).toHaveBeenCalledWith(
        'math',
        {
          grade_level: 'K',
          subject: 'Mathematics',
          standards_tags: ['CCSS.MATH.K.CC'],
        },
        'relevance',
        1,
        20,
      );
      expect(result).toEqual(mockResults);
    });
  });

  describe('getById', () => {
    it('should return template and increment view count', async () => {
      const mockTemplate = {
        id: 'template-1',
        title: 'Math Activity',
        is_published: true,
        deleted_at: null,
        creator: {
          id: 'teacher-1',
          first_name: 'John',
          last_name: 'Doe',
          email: 'john@example.com',
        },
      };
      mockPrismaService.activityTemplate.findUnique.mockResolvedValue(mockTemplate);
      mockPrismaService.activityTemplate.update.mockResolvedValue(mockTemplate);

      const result = await service.getById('template-1');

      expect(prisma.activityTemplate.findUnique).toHaveBeenCalledWith({
        where: { id: 'template-1', deleted_at: null },
        include: {
          creator: {
            select: {
              id: true,
              first_name: true,
              last_name: true,
              email: true,
            },
          },
        },
      });
      expect(prisma.activityTemplate.update).toHaveBeenCalledWith({
        where: { id: 'template-1' },
        data: { view_count: { increment: 1 } },
      });
      expect(result).toEqual(mockTemplate);
    });

    it('should throw NotFoundException if template not found', async () => {
      mockPrismaService.activityTemplate.findUnique.mockResolvedValue(null);

      await expect(service.getById('template-1')).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException if template not published', async () => {
      mockPrismaService.activityTemplate.findUnique.mockResolvedValue({
        id: 'template-1',
        is_published: false,
      });

      await expect(service.getById('template-1')).rejects.toThrow(ForbiddenException);
    });
  });

  describe('copy', () => {
    it('should create DRAFT activity from template and increment copy count', async () => {
      const mockTemplate = {
        id: 'template-1',
        title: 'Math Activity',
        description: 'Description',
        subject: 'Mathematics',
        grade_level: 'K',
        standards_tags: ['CCSS.MATH.K.CC'],
        is_published: true,
        deleted_at: null,
        blocks_snapshot: [
          {
            type: 'TEXT',
            content: { text: 'Hello' },
            is_required: true,
          },
        ],
      };
      const mockClassTeacher = { class_id: 'class-1', teacher_id: 'teacher-1' };
      const mockActivity = { id: 'activity-1', title: 'Math Activity' };

      mockPrismaService.activityTemplate.findUnique.mockResolvedValue(mockTemplate);
      mockPrismaService.classTeacher.findFirst.mockResolvedValue(mockClassTeacher);
      mockPrismaService.activity.create.mockResolvedValue(mockActivity);
      mockPrismaService.activityBlock.create.mockResolvedValue({});
      mockPrismaService.activityTemplate.update.mockResolvedValue(mockTemplate);

      const result = await service.copy('template-1', 'teacher-1', 'class-1');

      expect(prisma.activity.create).toHaveBeenCalledWith({
        data: {
          title: 'Math Activity',
          description: 'Description',
          class_id: 'class-1',
          created_by: 'teacher-1',
          status: ActivityStatus.DRAFT,
          is_from_library: true,
          library_source_id: 'template-1',
          standards_tags: ['CCSS.MATH.K.CC'],
          subject_tag: 'Mathematics',
          grade_level_tag: 'K',
        },
      });
      expect(prisma.activityBlock.create).toHaveBeenCalledTimes(1);
      expect(prisma.activityTemplate.update).toHaveBeenCalledWith({
        where: { id: 'template-1' },
        data: { copy_count: { increment: 1 } },
      });
      expect(result).toEqual(mockActivity);
    });

    it('should throw NotFoundException if template not found', async () => {
      mockPrismaService.activityTemplate.findUnique.mockResolvedValue(null);

      await expect(
        service.copy('template-1', 'teacher-1', 'class-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException if teacher does not have access to class', async () => {
      mockPrismaService.activityTemplate.findUnique.mockResolvedValue({
        is_published: true,
        deleted_at: null,
      });
      mockPrismaService.classTeacher.findFirst.mockResolvedValue(null);

      await expect(
        service.copy('template-1', 'teacher-1', 'class-1'),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('publish', () => {
    it('should create template, snapshot blocks, and enqueue sync job', async () => {
      const mockActivity = {
        id: 'activity-1',
        title: 'Math Activity',
        description: 'Description',
        subject_tag: 'Mathematics',
        grade_level_tag: 'K',
        standards_tags: ['CCSS.MATH.K.CC'],
        created_by: 'teacher-1',
        status: ActivityStatus.PUBLISHED,
        deleted_at: null,
        blocks: [
          {
            type: 'TEXT',
            content: { text: 'Hello' },
            is_required: true,
            order: 0,
          },
        ],
      };
      const mockTemplate = { id: 'template-1' };

      mockPrismaService.activity.findUnique.mockResolvedValue(mockActivity);
      mockPrismaService.activityTemplate.create.mockResolvedValue(mockTemplate);
      mockQueue.add.mockResolvedValue({});

      const result = await service.publish('activity-1', 'teacher-1');

      expect(prisma.activityTemplate.create).toHaveBeenCalledWith({
        data: {
          title: 'Math Activity',
          description: 'Description',
          subject: 'Mathematics',
          grade_level: 'K',
          standards_tags: ['CCSS.MATH.K.CC'],
          created_by: 'teacher-1',
          is_published: true,
          blocks_snapshot: [
            {
              type: 'TEXT',
              content: { text: 'Hello' },
              is_required: true,
            },
          ],
        },
      });
      expect(queue.add).toHaveBeenCalledWith('sync-template', {
        templateId: 'template-1',
      });
      expect(result).toEqual(mockTemplate);
    });

    it('should throw NotFoundException if activity not found', async () => {
      mockPrismaService.activity.findUnique.mockResolvedValue(null);

      await expect(service.publish('activity-1', 'teacher-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw ForbiddenException if teacher does not own activity', async () => {
      mockPrismaService.activity.findUnique.mockResolvedValue({
        created_by: 'other-teacher',
        status: ActivityStatus.PUBLISHED,
      });

      await expect(service.publish('activity-1', 'teacher-1')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should throw BadRequestException if activity not published', async () => {
      mockPrismaService.activity.findUnique.mockResolvedValue({
        created_by: 'teacher-1',
        status: ActivityStatus.DRAFT,
      });

      await expect(service.publish('activity-1', 'teacher-1')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('rate', () => {
    it('should upsert rating and recompute avg_rating', async () => {
      const mockTemplate = {
        id: 'template-1',
        is_published: true,
        deleted_at: null,
      };
      const mockAggregation = {
        _avg: { score: 4.5 },
        _count: { score: 10 },
      };

      mockPrismaService.activityTemplate.findUnique.mockResolvedValue(mockTemplate);
      mockPrismaService.templateRating.upsert.mockResolvedValue({});
      mockPrismaService.templateRating.aggregate.mockResolvedValue(mockAggregation);
      mockPrismaService.activityTemplate.update.mockResolvedValue(mockTemplate);

      const result = await service.rate('template-1', 'user-1', {
        score: 5,
        review: 'Great!',
      });

      expect(prisma.templateRating.upsert).toHaveBeenCalledWith({
        where: {
          template_id_user_id: {
            template_id: 'template-1',
            user_id: 'user-1',
          },
        },
        create: {
          template_id: 'template-1',
          user_id: 'user-1',
          score: 5,
          review: 'Great!',
        },
        update: {
          score: 5,
          review: 'Great!',
        },
      });
      expect(prisma.templateRating.aggregate).toHaveBeenCalledWith({
        where: { template_id: 'template-1' },
        _avg: { score: true },
        _count: { score: true },
      });
      expect(prisma.activityTemplate.update).toHaveBeenCalledWith({
        where: { id: 'template-1' },
        data: {
          avg_rating: 4.5,
          rating_count: 10,
        },
      });
      expect(result).toEqual({ success: true });
    });

    it('should throw NotFoundException if template not found', async () => {
      mockPrismaService.activityTemplate.findUnique.mockResolvedValue(null);

      await expect(
        service.rate('template-1', 'user-1', { score: 5 }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('getRatings', () => {
    it('should return paginated ratings list', async () => {
      const mockTemplate = { id: 'template-1', deleted_at: null };
      const mockRatings = [
        {
          id: 'rating-1',
          score: 5,
          review: 'Great!',
          rater: { id: 'user-1', first_name: 'John', last_name: 'Doe' },
        },
      ];
      const mockTotal = 1;

      mockPrismaService.activityTemplate.findUnique.mockResolvedValue(mockTemplate);
      mockPrismaService.templateRating.findMany.mockResolvedValue(mockRatings);
      mockPrismaService.templateRating.count.mockResolvedValue(mockTotal);

      const result = await service.getRatings('template-1', 1, 20);

      expect(result).toEqual({
        success: true,
        data: mockRatings,
        meta: {
          total: 1,
          page: 1,
          limit: 20,
          hasMore: false,
        },
      });
    });

    it('should throw NotFoundException if template not found', async () => {
      mockPrismaService.activityTemplate.findUnique.mockResolvedValue(null);

      await expect(service.getRatings('template-1', 1, 20)).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
