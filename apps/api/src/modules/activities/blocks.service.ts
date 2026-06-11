import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { BlockType, ActivityStatus } from '@prisma/client';
import { CreateBlockDto, UpdateBlockDto } from './dto';
import { BLOCK_CONTENT_SCHEMAS } from './schemas/block-content.schemas';
import { ZodError } from 'zod';

@Injectable()
export class BlocksService {
  constructor(private prisma: PrismaService) {}

  async addBlock(activityId: string, teacherId: string, dto: CreateBlockDto) {
    // Verify activity exists and is DRAFT
    const activity = await this.prisma.activity.findFirst({
      where: {
        id: activityId,
        deleted_at: null,
      },
      include: {
        class: {
          include: {
            teachers: {
              where: {
                teacher_id: teacherId,
              },
            },
          },
        },
      },
    });

    if (!activity) {
      throw new NotFoundException('Activity not found');
    }

    if (activity.class.teachers.length === 0) {
      throw new ForbiddenException('You do not have access to this activity');
    }

    if (activity.status !== ActivityStatus.DRAFT) {
      throw new BadRequestException(
        'Cannot modify blocks on a published activity',
      );
    }

    // Validate content against Zod schema
    this.validateBlockContent(dto.type, dto.content);

    // Create block
    return this.prisma.activityBlock.create({
      data: {
        activity_id: activityId,
        type: dto.type,
        content: dto.content,
        order: dto.order,
        is_required: dto.is_required ?? true,
      },
    });
  }

  async updateBlock(
    activityId: string,
    blockId: string,
    teacherId: string,
    dto: UpdateBlockDto,
  ) {
    // Verify activity exists and is DRAFT
    const activity = await this.prisma.activity.findFirst({
      where: {
        id: activityId,
        deleted_at: null,
      },
      include: {
        class: {
          include: {
            teachers: {
              where: {
                teacher_id: teacherId,
              },
            },
          },
        },
        blocks: {
          where: {
            id: blockId,
          },
        },
      },
    });

    if (!activity) {
      throw new NotFoundException('Activity not found');
    }

    if (activity.class.teachers.length === 0) {
      throw new ForbiddenException('You do not have access to this activity');
    }

    if (activity.status !== ActivityStatus.DRAFT) {
      throw new BadRequestException(
        'Cannot modify blocks on a published activity',
      );
    }

    const block = activity.blocks[0];
    if (!block) {
      throw new NotFoundException('Block not found');
    }

    // If content is being updated, validate it
    if (dto.content) {
      this.validateBlockContent(block.type, dto.content);
    }

    // Update block
    return this.prisma.activityBlock.update({
      where: { id: blockId },
      data: {
        content: dto.content,
        order: dto.order,
        is_required: dto.is_required,
      },
    });
  }

  async removeBlock(activityId: string, blockId: string, teacherId: string) {
    // Verify activity exists and is DRAFT
    const activity = await this.prisma.activity.findFirst({
      where: {
        id: activityId,
        deleted_at: null,
      },
      include: {
        class: {
          include: {
            teachers: {
              where: {
                teacher_id: teacherId,
              },
            },
          },
        },
        blocks: {
          orderBy: {
            order: 'asc',
          },
        },
      },
    });

    if (!activity) {
      throw new NotFoundException('Activity not found');
    }

    if (activity.class.teachers.length === 0) {
      throw new ForbiddenException('You do not have access to this activity');
    }

    if (activity.status !== ActivityStatus.DRAFT) {
      throw new BadRequestException(
        'Cannot modify blocks on a published activity',
      );
    }

    const blockToDelete = activity.blocks.find((b) => b.id === blockId);
    if (!blockToDelete) {
      throw new NotFoundException('Block not found');
    }

    // Delete block
    await this.prisma.activityBlock.delete({
      where: { id: blockId },
    });

    // Reorder remaining blocks
    const remainingBlocks = activity.blocks.filter((b) => b.id !== blockId);
    for (let i = 0; i < remainingBlocks.length; i++) {
      await this.prisma.activityBlock.update({
        where: { id: remainingBlocks[i].id },
        data: { order: i },
      });
    }

    return { message: 'Block removed successfully' };
  }

  async replaceAllBlocks(
    activityId: string,
    teacherId: string,
    blocks: CreateBlockDto[],
  ) {
    // Verify activity exists and is DRAFT
    const activity = await this.prisma.activity.findFirst({
      where: {
        id: activityId,
        deleted_at: null,
      },
      include: {
        class: {
          include: {
            teachers: {
              where: {
                teacher_id: teacherId,
              },
            },
          },
        },
      },
    });

    if (!activity) {
      throw new NotFoundException('Activity not found');
    }

    if (activity.class.teachers.length === 0) {
      throw new ForbiddenException('You do not have access to this activity');
    }

    if (activity.status !== ActivityStatus.DRAFT) {
      throw new BadRequestException(
        'Cannot modify blocks on a published activity',
      );
    }

    // Validate all blocks first
    for (const block of blocks) {
      this.validateBlockContent(block.type, block.content);
    }

    // Atomic replace: delete all existing blocks and create new ones
    await this.prisma.activityBlock.deleteMany({
      where: { activity_id: activityId },
    });

    const createdBlocks = await Promise.all(
      blocks.map((block, index) =>
        this.prisma.activityBlock.create({
          data: {
            activity_id: activityId,
            type: block.type,
            content: block.content,
            order: index,
            is_required: block.is_required ?? true,
          },
        }),
      ),
    );

    return createdBlocks;
  }

  private validateBlockContent(type: BlockType, content: any): void {
    const schema = BLOCK_CONTENT_SCHEMAS[type];

    if (!schema) {
      throw new BadRequestException(`Unknown block type: ${type}`);
    }

    try {
      schema.parse(content);

      // Additional referential integrity checks
      if (type === BlockType.MULTIPLE_CHOICE) {
        const optionIds = content.options.map((opt: any) => opt.id);
        if (!optionIds.includes(content.correctOptionId)) {
          throw new BadRequestException(
            'correctOptionId must reference an existing option id',
          );
        }
      }

      if (type === BlockType.DRAG_DROP) {
        const itemIds = content.items.map((item: any) => item.id);
        const targetIds = content.targets.map((target: any) => target.id);

        for (const [itemId, targetId] of Object.entries(
          content.correctMapping,
        )) {
          if (!itemIds.includes(itemId)) {
            throw new BadRequestException(
              `correctMapping key '${itemId}' does not exist in items`,
            );
          }
          if (!targetIds.includes(targetId)) {
            throw new BadRequestException(
              `correctMapping value '${targetId}' does not exist in targets`,
            );
          }
        }
      }
    } catch (error) {
      throw error;
    }
  }
}
