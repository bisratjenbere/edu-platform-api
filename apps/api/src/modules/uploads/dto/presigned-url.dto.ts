import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  MaxLength,
  IsIn,
  IsInt,
  Min,
  Max,
} from 'class-validator';
import { ALLOWED_MIME_MAP, ALLOWED_FOLDERS } from '../uploads.constants';

export class PresignedUrlDto {
  @ApiProperty({
    description: 'Original filename (used only for extension extraction)',
    example: 'my-photo.jpg',
    maxLength: 255,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  fileName!: string;

  @ApiProperty({
    description: 'MIME type declared by client',
    example: 'image/jpeg',
    enum: Object.keys(ALLOWED_MIME_MAP),
  })
  @IsString()
  @IsIn(Object.keys(ALLOWED_MIME_MAP), {
    message: 'File type not permitted',
  })
  fileType!: string;

  @ApiProperty({
    description: 'Upload destination folder',
    example: 'submissions',
    enum: ALLOWED_FOLDERS,
  })
  @IsString()
  @IsIn(ALLOWED_FOLDERS as unknown as string[], {
    message: 'Invalid folder',
  })
  folder!: string;

  @ApiProperty({
    description: 'Declared file size in bytes',
    example: 1048576,
    minimum: 1,
    maximum: 500 * 1024 * 1024,
  })
  @IsInt()
  @Min(1)
  @Max(500 * 1024 * 1024, {
    message: 'File size exceeds maximum allowed (500 MB)',
  })
  fileSizeBytes!: number;
}
