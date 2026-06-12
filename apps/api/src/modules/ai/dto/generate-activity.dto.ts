import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  MaxLength,
  IsOptional,
  IsEnum,
  IsArray,
} from 'class-validator';
import { BlockType, GradeLevel } from '@prisma/client';

export class GenerateActivityDto {
  @ApiProperty({
    description: 'Topic or learning standard description',
    maxLength: 500,
    example: 'Photosynthesis process for 3rd graders',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  topic!: string;

  @ApiPropertyOptional({
    description: 'Target grade level',
    enum: GradeLevel,
    example: GradeLevel.G3,
  })
  @IsOptional()
  @IsEnum(GradeLevel)
  gradeLevel?: GradeLevel;

  @ApiPropertyOptional({
    description: 'Subject area',
    maxLength: 100,
    example: 'Science',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  subject?: string;

  @ApiPropertyOptional({
    description: 'Learning standards tags',
    type: [String],
    example: ['NGSS.3-LS1-1'],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  standardsTags?: string[];

  @ApiPropertyOptional({
    description: 'Desired block types to include',
    enum: BlockType,
    isArray: true,
    example: [BlockType.TEXT, BlockType.MULTIPLE_CHOICE, BlockType.DRAWING_CANVAS],
  })
  @IsOptional()
  @IsArray()
  @IsEnum(BlockType, { each: true })
  blockTypes?: BlockType[];
}
