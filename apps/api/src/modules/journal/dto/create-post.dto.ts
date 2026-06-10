import { IsString, IsOptional, IsArray, IsUrl, MaxLength, ArrayMaxSize } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import sanitizeHtml from 'sanitize-html';

export class CreatePostDto {
  @ApiProperty({
    description: 'Post text content',
    example: 'Look what I made today!',
    maxLength: 5000,
    required: false,
  })
  @IsString()
  @IsOptional()
  @Transform(({ value }) => sanitizeHtml(value, { allowedTags: [] }))
  @MaxLength(5000)
  content_text?: string;

  @ApiProperty({
    description: 'Array of media URLs (CloudFront signed URLs)',
    example: ['https://cdn.eduflow.app/submissions/abc123/photo.jpg'],
    maxItems: 10,
    required: false,
    type: [String],
  })
  @IsArray()
  @IsOptional()
  @IsUrl({}, { each: true })
  @ArrayMaxSize(10)
  media_urls?: string[];
}
