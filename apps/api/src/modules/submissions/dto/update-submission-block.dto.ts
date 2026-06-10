import { IsUUID, IsObject } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateSubmissionBlockDto {
  @ApiProperty({ description: 'Activity block ID this response is for' })
  @IsUUID()
  block_id!: string;

  @ApiProperty({ description: 'Student response content (JSON)' })
  @IsObject()
  response_content!: Record<string, any>;
}
