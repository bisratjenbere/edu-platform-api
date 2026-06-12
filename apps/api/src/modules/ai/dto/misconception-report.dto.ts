import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class MisconceptionReportDto {
  @ApiProperty({
    description: 'Activity ID to analyze class-wide submission data for',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsUUID()
  activityId!: string;
}

export class MisconceptionItemDto {
  @ApiProperty({ description: 'Block order index this misconception relates to' })
  blockOrder!: number;

  @ApiProperty({ description: 'The question or prompt text' })
  questionText!: string;

  @ApiProperty({ description: 'Percentage of students who answered correctly (0–100)' })
  accuracyPercent!: number;

  @ApiProperty({ description: 'Plain-English description of the misconception pattern' })
  misconceptionDescription!: string;

  @ApiProperty({ description: 'Most common wrong answers and how many students chose each' })
  commonErrors!: Array<{ answer: string; count: number }>;

  @ApiProperty({ description: 'Suggested instructional focus to address this gap' })
  teachingSuggestion!: string;
}

export class MisconceptionReportResponseDto {
  @ApiProperty({ description: 'Overall class accuracy across all auto-graded blocks (0–100)' })
  overallAccuracyPercent!: number;

  @ApiProperty({ description: 'Number of submissions analyzed' })
  submissionsAnalyzed!: number;

  @ApiProperty({ type: [MisconceptionItemDto] })
  misconceptions!: MisconceptionItemDto[];

  @ApiProperty({ description: 'Plain-English executive summary for the teacher' })
  summary!: string;

  @ApiProperty({ description: 'Whether a follow-up activity is recommended' })
  followUpRecommended!: boolean;
}