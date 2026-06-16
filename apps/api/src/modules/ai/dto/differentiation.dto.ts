import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsUUID, IsOptional, IsString, MaxLength } from 'class-validator';

export class DifferentiationDto {
  @ApiProperty({
    description: 'Activity ID to differentiate',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsUUID()
  activityId!: string;

  @ApiProperty({
    description: 'Student ID to differentiate the activity for',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsUUID()
  studentId!: string;

  @ApiPropertyOptional({
    description: 'Optional teacher note about the student',
    maxLength: 300,
    example: 'Struggles with reading long passages but does well with visual tasks',
  })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  teacherNote?: string;
}

export class DifferentiationResponseDto {
  @ApiProperty({ description: 'Custom instructions for this student' })
  customInstructions!: string;

  @ApiProperty({ description: 'Specific block-level accommodations' })
  blockAccommodations!: Array<{
    blockOrder: number;
    blockType: string;
    accommodation: string;
  }>;

  @ApiProperty({ description: 'Summary of student strengths this differentiation builds on' })
  strengthsLeveraged!: string[];

  @ApiProperty({ description: 'Areas the accommodations specifically address' })
  supportAreas!: string[];
}