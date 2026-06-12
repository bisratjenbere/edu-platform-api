import {
  Injectable,
  BadRequestException,
  UnprocessableEntityException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { GenerateActivityDto, SaveGeneratedDto } from './dto';
import { z } from 'zod';
import { BlockType, ActivityStatus } from '@prisma/client';
import { BLOCK_CONTENT_SCHEMAS } from '../activities/schemas/block-content.schemas';
import axios from 'axios';

const AiActivitySchema = z.object({
  suggestedTitle: z.string().max(200),
  suggestedDescription: z.string().max(1000).optional(),
  blocks: z
    .array(
      z.object({
        type: z.nativeEnum(BlockType),
        content: z.record(z.string(), z.unknown()),
        order: z.number().int(),
      }),
    )
    .min(1)
    .max(20),
});

type AiActivityResponse = z.infer<typeof AiActivitySchema>;

@Injectable()
export class AiService {
  private readonly OPENROUTER_URL =
    'https://openrouter.ai/api/v1/chat/completions';
  private readonly MODEL = 'meta-llama/llama-3.3-70b-instruct:free';
  private readonly DAILY_LIMIT = 20;

  constructor(private prisma: PrismaService) {}

  /**
   * Generate activity blocks from AI without saving to database
   */
  async generateActivity(
    teacherId: string,
    dto: GenerateActivityDto,
  ): Promise<AiActivityResponse> {
    // Check daily rate limit
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    const usageCount = await this.prisma.aiUsageLog.count({
      where: {
        teacher_id: teacherId,
        created_at: {
          gte: today,
        },
      },
    });

    if (usageCount >= this.DAILY_LIMIT) {
      throw new HttpException(
        'Daily generation limit reached',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // Call OpenRouter API
    const messages = this.buildMessages(dto, false);
    let responseText: string;
    let promptTokens = 0;
    let completionTokens = 0;

    try {
      const response = await this.callOpenRouter(messages);
      responseText = response.text;
      promptTokens = response.promptTokens;
      completionTokens = response.completionTokens;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        throw new BadRequestException(
          `OpenRouter API error: ${error.message}`,
        );
      }
      throw new BadRequestException('Failed to generate activity');
    }

    // Parse and validate response
    let parsed: AiActivityResponse;
    try {
      parsed = this.parseAndValidate(responseText);
    } catch (parseError) {
      // Retry once with stricter prompt
      const strictMessages = this.buildMessages(dto, true);
      try {
        const retryResponse = await this.callOpenRouter(strictMessages);
        responseText = retryResponse.text;
        promptTokens = retryResponse.promptTokens;
        completionTokens = retryResponse.completionTokens;
        parsed = this.parseAndValidate(responseText);
      } catch (retryError) {
        throw new UnprocessableEntityException(
          'AI response could not be parsed',
        );
      }
    }

    // Log successful usage
    await this.prisma.aiUsageLog.create({
      data: {
        teacher_id: teacherId,
        feature: 'activity-generator',
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
      },
    });

    return parsed;
  }

  /**
   * Save AI-generated activity as DRAFT after teacher review
   */
  async saveGenerated(teacherId: string, dto: SaveGeneratedDto) {
    // Verify teacher owns the class
    const classTeacher = await this.prisma.classTeacher.findFirst({
      where: {
        class_id: dto.classId,
        teacher_id: teacherId,
      },
    });

    if (!classTeacher) {
      throw new BadRequestException('Class not found or access denied');
    }

    // Validate each block content against its schema
    for (const block of dto.blocks) {
      const schema = BLOCK_CONTENT_SCHEMAS[block.type];
      if (!schema) {
        throw new BadRequestException(
          `Invalid block type: ${block.type}`,
        );
      }

      const validation = schema.safeParse(block.content);
      if (!validation.success) {
        throw new BadRequestException(
          `Invalid content for block type ${block.type}: ${validation.error.message}`,
        );
      }
    }

    // Create activity with blocks in a transaction
    const activity = await this.prisma.$transaction(async (tx) => {
      const newActivity = await tx.activity.create({
        data: {
          title: dto.title,
          description: dto.description,
          class_id: dto.classId,
          created_by: teacherId,
          status: ActivityStatus.DRAFT,
          is_from_library: false,
        },
      });

      // Create all blocks
      await tx.activityBlock.createMany({
        data: dto.blocks.map((block) => ({
          activity_id: newActivity.id,
          type: block.type,
          content: block.content as any,
          order: block.order,
          is_required: true,
        })),
      });

      // Fetch complete activity with blocks
      return tx.activity.findUnique({
        where: { id: newActivity.id },
        include: {
          blocks: {
            orderBy: { order: 'asc' },
          },
        },
      });
    });

    return activity;
  }

  /**
   * Call OpenRouter API with OpenAI-compatible payload
   */
  private async callOpenRouter(
    messages: Array<{ role: string; content: string }>,
  ): Promise<{ text: string; promptTokens: number; completionTokens: number }> {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      throw new Error('OPENROUTER_API_KEY not configured');
    }

    const response = await axios.post(
      this.OPENROUTER_URL,
      {
        model: this.MODEL,
        messages,
        max_tokens: 2000,
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'HTTP-Referer': 'https://eduflow.app',
          'X-Title': 'EduFlow',
          'Content-Type': 'application/json',
        },
      },
    );

    const text = response.data.choices[0]?.message?.content || '';
    const promptTokens = response.data.usage?.prompt_tokens || 0;
    const completionTokens = response.data.usage?.completion_tokens || 0;

    return { text, promptTokens, completionTokens };
  }

  /**
   * Build system + user messages for OpenRouter API
   */
  private buildMessages(
    dto: GenerateActivityDto,
    strict: boolean,
  ): Array<{ role: string; content: string }> {
    const systemPrompt = strict
      ? 'You are an expert elementary curriculum designer. Return ONLY raw JSON, no markdown fences, no preamble.'
      : 'You are an expert elementary curriculum designer. Respond ONLY with valid JSON. No markdown, no preamble.';

    let userPrompt = `Generate an educational activity about: ${dto.topic}`;

    if (dto.gradeLevel) {
      userPrompt += `\nGrade level: ${dto.gradeLevel}`;
    }
    if (dto.subject) {
      userPrompt += `\nSubject: ${dto.subject}`;
    }
    if (dto.standardsTags && dto.standardsTags.length > 0) {
      userPrompt += `\nStandards: ${dto.standardsTags.join(', ')}`;
    }
    if (dto.blockTypes && dto.blockTypes.length > 0) {
      userPrompt += `\nPreferred block types: ${dto.blockTypes.join(', ')}`;
    }

    userPrompt += `\n\nRespond with JSON in this exact format:
{
  "suggestedTitle": "Activity title (max 200 chars)",
  "suggestedDescription": "Brief description (max 1000 chars, optional)",
  "blocks": [
    {
      "type": "TEXT",
      "content": { "html": "<p>Instructions here</p>" },
      "order": 0
    },
    {
      "type": "MULTIPLE_CHOICE",
      "content": {
        "question": "Question text?",
        "options": [
          { "id": "opt1", "text": "Option 1" },
          { "id": "opt2", "text": "Option 2" }
        ],
        "correctOptionId": "opt1",
        "allowMultipleCorrect": false
      },
      "order": 1
    }
  ]
}

Available block types: TEXT, MULTIPLE_CHOICE, TRUE_FALSE, SHORT_ANSWER, OPEN_ENDED, DRAWING_CANVAS, POLL, DRAG_DROP
Each block type has specific content requirements - ensure content matches the type.`;

    return [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ];
  }

  /**
   * Parse AI response and validate with Zod schema
   */
  private parseAndValidate(responseText: string): AiActivityResponse {
    // Strip markdown fences if present
    let cleaned = responseText.trim();
    const jsonMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (jsonMatch) {
      cleaned = jsonMatch[1].trim();
    }

    // Parse JSON
    let parsed: unknown;
    try {
      parsed = JSON.parse(cleaned);
    } catch (error) {
      throw new Error('Invalid JSON');
    }

    // Validate with Zod
    const result = AiActivitySchema.safeParse(parsed);
    if (!result.success) {
      throw new Error(`Validation failed: ${result.error.message}`);
    }

    return result.data;
  }
}
