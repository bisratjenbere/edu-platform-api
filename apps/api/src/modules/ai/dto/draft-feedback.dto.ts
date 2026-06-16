import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsUUID,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class DraftFeedbackDto {
  @ApiProperty({
    description: 'Submission ID to draft feedback for',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsUUID()
  submissionId!: string;

  @ApiPropertyOptional({
    description: 'Optional teacher tone preference',
    maxLength: 200,
    example: 'encouraging and specific',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  toneHint?: string;
}

export class DraftFeedbackResponseDto {
  @ApiProperty({ description: 'AI-drafted feedback text for the teacher to review and edit' })
  draftFeedback!: string;

  @ApiProperty({ description: 'Summary of what the student demonstrated across blocks' })
  strengthsSummary!: string;

  @ApiProperty({ description: 'Areas where the student may need support' })
  growthAreas!: string[];
}