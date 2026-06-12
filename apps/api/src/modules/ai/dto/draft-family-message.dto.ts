import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsUUID, IsOptional, IsString, MaxLength } from 'class-validator';

export class DraftFamilyMessageDto {
  @ApiProperty({
    description: 'Student ID to draft a progress message about',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsUUID()
  studentId!: string;

  @ApiProperty({
    description: 'Class ID (scopes journal/submission data to the right class)',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsUUID()
  classId!: string;

  @ApiPropertyOptional({
    description: 'Optional focus area for the message',
    maxLength: 200,
    example: 'recent progress in reading fluency',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  focusArea?: string;
}

export class DraftFamilyMessageResponseDto {
  @ApiProperty({ description: 'AI-drafted message body for the teacher to edit and send' })
  draftMessage!: string;

  @ApiProperty({ description: 'Suggested subject line' })
  suggestedSubject!: string;

  @ApiProperty({ description: 'Key student highlights the message was based on' })
  highlightsUsed!: string[];
}