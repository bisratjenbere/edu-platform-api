import {
  IsString,
  IsNotEmpty,
  MaxLength,
  IsArray,
  IsOptional,
  ValidateNested,
  IsUrl,
  IsIn,
  ArrayMaxSize,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

class MessageAttachmentDto {
  @ApiProperty({
    description: 'URL of the attachment (must be a signed CloudFront URL)',
    example: 'https://cdn.eduflow.app/uploads/...',
  })
  @IsUrl()
  url!: string;

  @ApiProperty({
    description: 'Type of attachment',
    enum: ['image', 'pdf', 'link'],
    example: 'image',
  })
  @IsIn(['image', 'pdf', 'link'])
  type!: 'image' | 'pdf' | 'link';

  @ApiProperty({
    description: 'Display name for the attachment',
    example: 'Field_trip_form.pdf',
  })
  @IsString()
  @MaxLength(255)
  displayName!: string;
}

export class SendMessageDto {
  @ApiProperty({
    description: 'Message body text',
    maxLength: 10000,
    example: 'Please sign and return the field trip form by Friday.',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(10000)
  body!: string;

  @ApiPropertyOptional({
    description: 'Array of attachments (max 5)',
    type: [MessageAttachmentDto],
    maxItems: 5,
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @ValidateNested({ each: true })
  @Type(() => MessageAttachmentDto)
  attachments?: MessageAttachmentDto[];
}
