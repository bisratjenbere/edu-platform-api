import {
  IsEnum,
  IsObject,
  IsInt,
  IsBoolean,
  IsOptional,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BlockType } from '@prisma/client';

export class CreateBlockDto {
  @ApiProperty({ description: 'Block type', enum: BlockType })
  @IsEnum(BlockType)
  type!: BlockType;

  @ApiProperty({ description: 'Block content (JSON)' })
  @IsObject()
  content!: Record<string, any>;

  @ApiProperty({ description: 'Display order of the block' })
  @IsInt()
  order!: number;

  @ApiPropertyOptional({
    description: 'Is this block required for submission',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  is_required?: boolean;
}
