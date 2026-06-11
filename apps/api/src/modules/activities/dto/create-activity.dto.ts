import {
  IsString,
  IsOptional,
  IsUUID,
  IsDateString,
  IsEnum,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AssignedTo } from '@prisma/client';

export class CreateActivityDto {
  @ApiProperty({ description: 'Activity title', maxLength: 200 })
  @IsString()
  @MaxLength(200)
  title!: string;

  @ApiPropertyOptional({ description: 'Activity description' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ description: 'Class ID this activity belongs to' })
  @IsUUID()
  class_id!: string;

  @ApiPropertyOptional({ description: 'Due date for the activity' })
  @IsOptional()
  @IsDateString()
  due_date?: string;

  @ApiPropertyOptional({ description: 'Scheduled publish date/time' })
  @IsOptional()
  @IsDateString()
  scheduled_publish_at?: string;

  @ApiProperty({
    description: 'Assignment type',
    enum: AssignedTo,
    default: AssignedTo.WHOLE_CLASS,
  })
  @IsEnum(AssignedTo)
  assigned_to!: AssignedTo;
}
