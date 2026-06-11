import { IsArray, IsUUID, IsOptional, IsObject } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AssignIndividualDto {
  @ApiProperty({ description: 'Array of student IDs to assign to', type: [String] })
  @IsArray()
  @IsUUID('4', { each: true })
  student_ids!: string[];

  @ApiPropertyOptional({
    description: 'Custom instructions per student (map of studentId → string)',
  })
  @IsOptional()
  @IsObject()
  custom_instructions?: Record<string, string>;
}
