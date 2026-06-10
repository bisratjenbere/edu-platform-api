import {
  IsEnum,
  IsString,
  IsOptional,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SubmissionStatus } from '@prisma/client';

export class TeacherFeedbackDto {
  @ApiProperty({
    description: 'New submission status (only RETURNED or APPROVED allowed)',
    enum: [SubmissionStatus.RETURNED, SubmissionStatus.APPROVED],
  })
  @IsEnum(SubmissionStatus)
  @ValidateIf(
    (o) =>
      o.status === SubmissionStatus.RETURNED ||
      o.status === SubmissionStatus.APPROVED,
  )
  status!: SubmissionStatus;

  @ApiPropertyOptional({
    description: 'Text feedback from teacher',
    maxLength: 5000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  feedback_text?: string;

  @ApiPropertyOptional({ description: 'Audio feedback URL (CloudFront signed)' })
  @IsOptional()
  @IsString()
  feedback_audio_url?: string;
}
