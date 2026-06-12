import { ApiProperty } from '@nestjs/swagger';
import { IsUUID, IsString, IsNotEmpty, MaxLength, IsEnum } from 'class-validator';
import { BlockType } from '@prisma/client';

export class RubricGeneratorDto {
  @ApiProperty({
    description: 'Activity ID the block belongs to (used to fetch grade level context)',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsUUID()
  activityId!: string;

  @ApiProperty({
    description: 'Block type — must be SHORT_ANSWER or OPEN_ENDED',
    enum: [BlockType.SHORT_ANSWER, BlockType.OPEN_ENDED],
  })
  @IsEnum([BlockType.SHORT_ANSWER, BlockType.OPEN_ENDED])
  blockType!: BlockType.SHORT_ANSWER | BlockType.OPEN_ENDED;

  @ApiProperty({
    description: 'The prompt text from the block',
    maxLength: 1000,
    example: 'Describe what happens during photosynthesis in your own words.',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  promptText!: string;
}

export class RubricLevelDto {
  @ApiProperty({ example: 'Exceeds Expectations' })
  level!: string;

  @ApiProperty({ example: 3 })
  points!: number;

  @ApiProperty({ description: 'Concrete, observable description of performance at this level' })
  description!: string;

  @ApiProperty({ description: 'Example student response at this level' })
  exampleResponse!: string;
}

export class RubricResponseDto {
  @ApiProperty({ type: [RubricLevelDto] })
  levels!: RubricLevelDto[];

  @ApiProperty({ description: 'Key criteria the rubric focuses on' })
  focusCriteria!: string[];

  @ApiProperty({ description: 'Student-facing version of the rubric (simplified language)' })
  studentFacingDescription!: string;
}