import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  IsInt,
  Min,
  Max,
} from 'class-validator';
import { GradeLevel } from '@prisma/client';

export class FluencyPassageDto {
  @ApiProperty({
    description: 'Grade level to calibrate reading difficulty',
    enum: GradeLevel,
    example: GradeLevel.G2,
  })
  @IsEnum(GradeLevel)
  gradeLevel!: GradeLevel;

  @ApiPropertyOptional({
    description: 'Optional topic to connect the passage to current class content',
    maxLength: 200,
    example: 'life cycles of butterflies',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  topic?: string;

  @ApiPropertyOptional({
    description: 'Target word count for the passage',
    minimum: 50,
    maximum: 300,
    example: 100,
  })
  @IsOptional()
  @IsInt()
  @Min(50)
  @Max(300)
  targetWordCount?: number;
}

export class FluencyPassageResponseDto {
  @ApiProperty({ description: 'The generated reading passage' })
  passageText!: string;

  @ApiProperty({ description: 'Actual word count of the generated passage' })
  wordCount!: number;

  @ApiProperty({ description: 'Estimated Lexile level range' })
  estimatedLexileRange!: string;

  @ApiProperty({ description: 'Key vocabulary words in the passage the teacher may want to pre-teach' })
  keyVocabulary!: string[];
}