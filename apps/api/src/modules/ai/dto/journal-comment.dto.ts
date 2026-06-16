import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class JournalCommentSuggestionDto {
  @ApiProperty({
    description: 'Journal post ID to generate a comment suggestion for',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsUUID()
  journalPostId!: string;
}

export class JournalCommentSuggestionResponseDto {
  @ApiProperty({ description: 'Suggested comment text for the teacher to edit and post' })
  suggestedComment!: string;

  @ApiProperty({ description: 'Alternative shorter comment option' })
  shortAlternative!: string;
}