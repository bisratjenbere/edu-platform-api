import { IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class PublishTemplateDto {
  @ApiProperty({ description: 'Activity ID to publish as template' })
  @IsUUID()
  activityId!: string;
}
