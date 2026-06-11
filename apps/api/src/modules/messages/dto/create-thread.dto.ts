import {
  IsEnum,
  IsUUID,
  IsString,
  IsOptional,
  MaxLength,
  IsArray,
  IsBoolean,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ThreadType } from '@prisma/client';

export class CreateThreadDto {
  @ApiProperty({
    enum: ThreadType,
    description: 'Type of thread: DIRECT, GROUP, or ANNOUNCEMENT',
  })
  @IsEnum(ThreadType)
  thread_type!: ThreadType;

  @ApiProperty({
    description: 'Class ID this thread belongs to',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsUUID()
  class_id!: string;

  @ApiPropertyOptional({
    description: 'Subject line for the thread (optional)',
    maxLength: 200,
    example: 'Field trip permission forms',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  subject?: string;

  @ApiProperty({
    description:
      'Array of recipient user IDs (required for DIRECT and GROUP types)',
    type: [String],
    example: ['123e4567-e89b-12d3-a456-426614174001'],
  })
  @IsArray()
  @IsUUID('4', { each: true })
  recipient_ids!: string[];

  @ApiPropertyOptional({
    description: 'Whether recipients can reply (default: true)',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  allow_replies?: boolean;
}
