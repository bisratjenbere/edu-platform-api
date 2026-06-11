import { IsUUID, IsString, MinLength, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class TranslateMessageDto {
  @ApiProperty({
    description: 'Message ID to translate',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsUUID()
  message_id!: string;

  @ApiProperty({
    description: 'Target language code (ISO 639-1)',
    minLength: 2,
    maxLength: 5,
    example: 'es',
  })
  @IsString()
  @MinLength(2)
  @MaxLength(5)
  target_lang!: string;
}
