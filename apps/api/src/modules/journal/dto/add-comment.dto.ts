import { IsString, IsNotEmpty, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import sanitizeHtml from 'sanitize-html';

export class AddCommentDto {
  @ApiProperty({
    description: 'Comment text content',
    example: 'Great work! I love the colors you used.',
    maxLength: 1000,
  })
  @IsString()
  @IsNotEmpty()
  @Transform(({ value }) => sanitizeHtml(value, { allowedTags: [] }))
  @MaxLength(1000)
  content!: string;
}
