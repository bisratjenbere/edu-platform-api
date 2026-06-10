import { IsString, IsOptional, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import sanitizeHtml from 'sanitize-html';

export class RejectPostDto {
  @ApiProperty({
    description: 'Optional reason for rejecting the post',
    example: 'This content is not appropriate for the journal',
    maxLength: 500,
    required: false,
  })
  @IsString()
  @IsOptional()
  @Transform(({ value }) => sanitizeHtml(value, { allowedTags: [] }))
  @MaxLength(500)
  reason?: string;
}
