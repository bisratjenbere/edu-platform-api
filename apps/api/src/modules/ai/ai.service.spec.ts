import { Test, TestingModule } from '@nestjs/testing';
import { AiService } from './ai.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  BadRequestException,
  UnprocessableEntityException,
  HttpStatus,
} from '@nestjs/common';
import { BlockType, ActivityStatus } from '@prisma/client';
import axios from 'axios';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('AiService', () => {
  let service: AiService;
  let prisma: PrismaService;

  const mockPrisma = {
    aiUsageLog: {
      count: jest.fn(),
      create: jest.fn(),
    },
    classTeacher: {
      findFirst: jest.fn(),
    },
    activity: {
      create: jest.fn(),
      findUnique: jest.fn(),
    },
    activityBlock: {
      createMany: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiService,
        {
          provide: PrismaService,
          useValue: mockPrisma,
        },
      ],
    }).compile();

    service = module.get<AiService>(AiService);
    prisma = module.get<PrismaService>(PrismaService);

    jest.clearAllMocks();
    delete process.env.OPENROUTER_API_KEY;
  });

  describe('generateActivity', () => {
    const mockTeacherId = 'teacher-123';
    const mockDto = {
      topic: 'Photosynthesis for 3rd graders',
      gradeLevel: undefined,
      subject: 'Science',
    };

    it('should generate activity successfully with valid AI response', async () => {
      // Mock rate limit check
      mockPrisma.aiUsageLog.count.mockResolvedValue(5);

      // Mock OpenRouter API response
      process.env.OPENROUTER_API_KEY = 'test-api-key';
      const mockApiResponse = {
        data: {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  suggestedTitle: 'Understanding Photosynthesis',
                  suggestedDescription: 'Learn how plants make food',
                  blocks: [
                    {
                      type: BlockType.TEXT,
                      content: { html: '<p>Photosynthesis is...</p>' },
                      order: 0,
                    },
                    {
                      type: BlockType.MULTIPLE_CHOICE,
                      content: {
                        question: 'What do plants need?',
                        options: [
                          { id: 'opt1', text: 'Sunlight' },
                          { id: 'opt2', text: 'Water' },
                        ],
                        correctOptionId: 'opt1',
                        allowMultipleCorrect: false,
                      },
                      order: 1,
                    },
                  ],
                }),
              },
            },
          ],
          usage: {
            prompt_tokens: 100,
            completion_tokens: 200,
          },
        },
      };
      mockedAxios.post.mockResolvedValue(mockApiResponse);

      // Mock usage log creation
      mockPrisma.aiUsageLog.create.mockResolvedValue({
        id: 'log-123',
        teacher_id: mockTeacherId,
        feature: 'activity-generator',
        prompt_tokens: 100,
        completion_tokens: 200,
        created_at: new Date(),
      });

      const result = await service.generateActivity(mockTeacherId, mockDto);

      expect(result.suggestedTitle).toBe('Understanding Photosynthesis');
      expect(result.blocks).toHaveLength(2);
      expect(result.blocks[0].type).toBe(BlockType.TEXT);
      expect(mockPrisma.aiUsageLog.count).toHaveBeenCalledWith({
        where: {
          teacher_id: mockTeacherId,
          created_at: {
            gte: expect.any(Date),
          },
        },
      });
      expect(mockPrisma.aiUsageLog.create).toHaveBeenCalledWith({
        data: {
          teacher_id: mockTeacherId,
          feature: 'activity-generator',
          prompt_tokens: 100,
          completion_tokens: 200,
        },
      });
    });

    it('should throw 429 when daily limit is reached', async () => {
      mockPrisma.aiUsageLog.count.mockResolvedValue(20);

      await expect(
        service.generateActivity(mockTeacherId, mockDto),
      ).rejects.toThrow('Daily generation limit reached');

      expect(mockPrisma.aiUsageLog.count).toHaveBeenCalled();
    });

    it('should retry once on parse failure and succeed', async () => {
      mockPrisma.aiUsageLog.count.mockResolvedValue(5);
      process.env.OPENROUTER_API_KEY = 'test-api-key';

      // First call returns invalid JSON
      const invalidResponse = {
        data: {
          choices: [{ message: { content: 'invalid json here' } }],
          usage: { prompt_tokens: 50, completion_tokens: 50 },
        },
      };

      // Second call returns valid JSON
      const validResponse = {
        data: {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  suggestedTitle: 'Test Activity',
                  blocks: [
                    {
                      type: BlockType.TEXT,
                      content: { html: '<p>Test</p>' },
                      order: 0,
                    },
                  ],
                }),
              },
            },
          ],
          usage: { prompt_tokens: 60, completion_tokens: 70 },
        },
      };

      mockedAxios.post
        .mockResolvedValueOnce(invalidResponse)
        .mockResolvedValueOnce(validResponse);

      mockPrisma.aiUsageLog.create.mockResolvedValue({
        id: 'log-123',
        teacher_id: mockTeacherId,
        feature: 'activity-generator',
        prompt_tokens: 60,
        completion_tokens: 70,
        created_at: new Date(),
      });

      const result = await service.generateActivity(mockTeacherId, mockDto);

      expect(result.suggestedTitle).toBe('Test Activity');
      expect(mockedAxios.post).toHaveBeenCalledTimes(2);
      expect(mockPrisma.aiUsageLog.create).toHaveBeenCalled();
    });

    it('should throw 422 when second parse attempt also fails', async () => {
      mockPrisma.aiUsageLog.count.mockResolvedValue(5);
      process.env.OPENROUTER_API_KEY = 'test-api-key';

      const invalidResponse = {
        data: {
          choices: [{ message: { content: 'still invalid' } }],
          usage: { prompt_tokens: 50, completion_tokens: 50 },
        },
      };

      mockedAxios.post.mockResolvedValue(invalidResponse);

      await expect(
        service.generateActivity(mockTeacherId, mockDto),
      ).rejects.toThrow(UnprocessableEntityException);

      expect(mockedAxios.post).toHaveBeenCalledTimes(2);
    });

    it('should strip markdown fences from AI response', async () => {
      mockPrisma.aiUsageLog.count.mockResolvedValue(5);
      process.env.OPENROUTER_API_KEY = 'test-api-key';

      const responseWithFences = {
        data: {
          choices: [
            {
              message: {
                content: '```json\n' + JSON.stringify({
                  suggestedTitle: 'Test',
                  blocks: [
                    {
                      type: BlockType.TEXT,
                      content: { html: '<p>Test</p>' },
                      order: 0,
                    },
                  ],
                }) + '\n```',
              },
            },
          ],
          usage: { prompt_tokens: 100, completion_tokens: 200 },
        },
      };

      mockedAxios.post.mockResolvedValue(responseWithFences);
      mockPrisma.aiUsageLog.create.mockResolvedValue({} as any);

      const result = await service.generateActivity(mockTeacherId, mockDto);

      expect(result.suggestedTitle).toBe('Test');
    });
  });

  describe('saveGenerated', () => {
    const mockTeacherId = 'teacher-123';
    const mockDto = {
      classId: 'class-123',
      title: 'Test Activity',
      description: 'Test description',
      blocks: [
        {
          type: BlockType.TEXT,
          content: { html: '<p>Instructions</p>' },
          order: 0,
        },
        {
          type: BlockType.MULTIPLE_CHOICE,
          content: {
            question: 'What is 2+2?',
            options: [
              { id: 'opt1', text: '3' },
              { id: 'opt2', text: '4' },
            ],
            correctOptionId: 'opt2',
            allowMultipleCorrect: false,
          },
          order: 1,
        },
      ],
    };

    it('should save activity successfully when teacher owns class', async () => {
      mockPrisma.classTeacher.findFirst.mockResolvedValue({
        class_id: 'class-123',
        teacher_id: mockTeacherId,
        role: 'PRIMARY',
        joined_at: new Date(),
        deleted_at: null,
      });

      const mockActivity = {
        id: 'activity-123',
        title: mockDto.title,
        description: mockDto.description,
        class_id: mockDto.classId,
        created_by: mockTeacherId,
        status: ActivityStatus.DRAFT,
        blocks: mockDto.blocks.map((b, i) => ({
          id: `block-${i}`,
          activity_id: 'activity-123',
          type: b.type,
          content: b.content,
          order: b.order,
          is_required: true,
          created_at: new Date(),
        })),
      };

      mockPrisma.$transaction.mockImplementation(async (callback: any) => {
        return callback(prisma);
      });

      mockPrisma.activity.create.mockResolvedValue({
        id: 'activity-123',
        title: mockDto.title,
      } as any);

      mockPrisma.activityBlock.createMany.mockResolvedValue({ count: 2 });

      mockPrisma.activity.findUnique.mockResolvedValue(mockActivity as any);

      const result = await service.saveGenerated(mockTeacherId, mockDto);

      expect(result).toBeDefined();
      expect(result!.id).toBe('activity-123');
      expect(result!.status).toBe(ActivityStatus.DRAFT);
      expect(result!.blocks).toHaveLength(2);
      expect(mockPrisma.classTeacher.findFirst).toHaveBeenCalledWith({
        where: {
          class_id: mockDto.classId,
          teacher_id: mockTeacherId,
          deleted_at: null,
        },
      });
    });

    it('should throw 400 when teacher does not own class', async () => {
      mockPrisma.classTeacher.findFirst.mockResolvedValue(null);

      await expect(
        service.saveGenerated(mockTeacherId, mockDto),
      ).rejects.toThrow(BadRequestException);

      expect(mockPrisma.classTeacher.findFirst).toHaveBeenCalled();
    });

    it('should throw 400 when block content is invalid', async () => {
      mockPrisma.classTeacher.findFirst.mockResolvedValue({
        class_id: 'class-123',
        teacher_id: mockTeacherId,
      } as any);

      const invalidDto = {
        ...mockDto,
        blocks: [
          {
            type: BlockType.TEXT,
            content: { invalid: 'field' }, // Missing 'html' field
            order: 0,
          },
        ],
      };

      await expect(
        service.saveGenerated(mockTeacherId, invalidDto),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
