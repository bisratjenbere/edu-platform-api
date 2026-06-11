import { IsString, IsOptional, IsEnum, IsNotEmpty, MaxLength, Matches, IsHexColor } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { GradeLevel } from '@prisma/client';

export class CreateClassDto {
  @ApiProperty({ example: 'Ms. Smith\'s 2nd Grade' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;

  @ApiPropertyOptional({ example: 'Mathematics' })
  @IsString()
  @IsOptional()
  @MaxLength(50)
  subject?: string;

  @ApiPropertyOptional({ enum: GradeLevel, example: 'G2' })
  @IsEnum(GradeLevel)
  @IsOptional()
  grade_level?: GradeLevel;

  @ApiProperty({ example: '2025-2026', description: 'Format: YYYY-YYYY' })
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{4}-\d{4}$/, { message: 'School year must be in format YYYY-YYYY' })
  school_year!: string;

  @ApiPropertyOptional({ example: '#4F46E5', description: 'Hex color code' })
  @IsHexColor()
  @IsOptional()
  cover_color?: string;
}
