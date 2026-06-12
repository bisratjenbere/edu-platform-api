import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsUUID,
  MaxLength,
  IsOptional,
  IsArray,
  ValidateNested,
  IsEnum,
  IsInt,
  IsObject,
} from 'class-validator';
import { Type } from 'class-transformer';
import { BlockType } from '@prisma/client';

class BlockDto {
  @ApiProperty({
    description: 'Block type',
    enum: BlockType,
    example: BlockType.TEXT,
  })
  @IsEnum(BlockType)
  type!: BlockType;

  @ApiProperty({
    description: 'Block content (schema depends on type)',
    example: { text: 'Instructions go here' },
  })
  @IsObject()
  content!: Record<string, unknown>;

  @ApiProperty({
    description: 'Display order (0-indexed)',
    example: 0,
  })
  @IsInt()
  order!: number;
}

export class SaveGeneratedDto {
  @ApiProperty({
    description: 'Class ID to save activity to',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsUUID()
  classId!: string;

  @ApiProperty({
    description: 'Activity title',
    maxLength: 200,
    example: 'Understanding Photosynthesis',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title!: string;

  @ApiPropertyOptional({
    description: 'Activity description',
    example: 'Learn how plants make their own food using sunlight',
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({
    description: 'Array of activity blocks',
    type: [BlockDto],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BlockDto)
  blocks!: BlockDto[];
}
