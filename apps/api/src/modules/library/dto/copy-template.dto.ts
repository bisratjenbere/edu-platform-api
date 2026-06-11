import { IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CopyTemplateDto {
  @ApiProperty({ description: 'Class ID to copy template into' })
  @IsUUID()
  classId!: string;
}
