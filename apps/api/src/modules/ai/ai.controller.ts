import {
  Controller,
  Post,
  Body,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { AiService } from './ai.service';
import { GenerateActivityDto, SaveGeneratedDto } from './dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { Role } from '@prisma/client';

@ApiTags('ai')
@Controller('ai')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Post('generate-activity')
  @Roles(Role.TEACHER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Generate activity blocks from AI (does not save)',
    description:
      'Teachers describe a topic and AI generates activity blocks. Rate limited to 20 per day per teacher.',
  })
  @ApiResponse({
    status: 200,
    description: 'Activity blocks generated successfully',
    schema: {
      properties: {
        success: { type: 'boolean', example: true },
        data: {
          type: 'object',
          properties: {
            suggestedTitle: { type: 'string', example: 'Understanding Photosynthesis' },
            suggestedDescription: {
              type: 'string',
              example: 'Learn how plants make their own food',
            },
            blocks: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  type: { type: 'string', example: 'TEXT' },
                  content: { type: 'object' },
                  order: { type: 'number', example: 0 },
                },
              },
            },
          },
        },
        error: { type: 'null' },
      },
    },
  })
  @ApiResponse({
    status: 422,
    description: 'AI response could not be parsed',
  })
  @ApiResponse({
    status: 429,
    description: 'Daily generation limit reached',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - invalid or missing JWT token',
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - user is not a teacher',
  })
  async generateActivity(
    @Request() req: any,
    @Body() dto: GenerateActivityDto,
  ) {
    const result = await this.aiService.generateActivity(req.user.id, dto);
    return {
      success: true,
      data: result,
      error: null,
    };
  }

  @Post('save-generated')
  @Roles(Role.TEACHER)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Save AI-generated activity as DRAFT',
    description:
      'After reviewing AI-generated blocks, save them as a DRAFT activity in the specified class.',
  })
  @ApiResponse({
    status: 201,
    description: 'Activity saved successfully',
    schema: {
      properties: {
        success: { type: 'boolean', example: true },
        data: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            title: { type: 'string' },
            description: { type: 'string', nullable: true },
            class_id: { type: 'string', format: 'uuid' },
            created_by: { type: 'string', format: 'uuid' },
            status: { type: 'string', example: 'DRAFT' },
            blocks: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string', format: 'uuid' },
                  activity_id: { type: 'string', format: 'uuid' },
                  type: { type: 'string' },
                  content: { type: 'object' },
                  order: { type: 'number' },
                  is_required: { type: 'boolean' },
                },
              },
            },
          },
        },
        error: { type: 'null' },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid block content or class not found',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - invalid or missing JWT token',
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - user is not a teacher',
  })
  async saveGenerated(@Request() req: any, @Body() dto: SaveGeneratedDto) {
    const result = await this.aiService.saveGenerated(req.user.id, dto);
    return {
      success: true,
      data: result,
      error: null,
    };
  }
}
