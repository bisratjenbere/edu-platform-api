import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class TemplateQualityDto {
  @ApiProperty({
    description: 'ActivityTemplate ID to score',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsUUID()
  templateId!: string;
}

export class TemplateQualityResponseDto {
  @ApiProperty({ description: 'Overall quality score 1–5' })
  overallScore!: number;

  @ApiProperty({ description: 'Clarity of instructions score 1–5' })
  clarityScore!: number;

  @ApiProperty({ description: 'Age-appropriateness score 1–5' })
  ageAppropriatenessScore!: number;

  @ApiProperty({ description: 'Block variety score 1–5' })
  blockVarietyScore!: number;

  @ApiProperty({ description: 'Standards alignment score 1–5' })
  standardsAlignmentScore!: number;

  @ApiProperty({ description: 'Specific improvement suggestions' })
  improvementSuggestions!: string[];

  @ApiProperty({ description: 'Whether this template is recommended for the public library' })
  recommendedForLibrary!: boolean;

  @ApiProperty({ description: 'Brief qualitative summary' })
  qualitySummary!: string;
}