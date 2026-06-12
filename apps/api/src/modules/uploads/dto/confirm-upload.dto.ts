import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, Matches } from 'class-validator';

export class ConfirmUploadDto {
  /**
   * S3 object key returned from the presigned-url step.
   *
   * Key format: {folder}/{userId}/{uuid}.{ext}
   *   segment 0 — folder:   one or more lowercase letters  [a-z]+
   *   segment 1 — userId:   Prisma CUID / UUID — lowercase hex, digits, hyphens, underscores
   *                         [\w-]+  (covers cuid2 prefixes such as "usr_abc123" too)
   *   segment 2 — filename: UUID v4 (hex + hyphens) with a lowercase alphanumeric extension
   *                         [a-f0-9-]+\.[a-z0-9]+
   *
   * NOTE: If the auth system ever changes userId format, update this regex and the
   * generateKey() private method in UploadsService together.
   */
  @ApiProperty({
    description: 'S3 object key returned from presigned-url step',
    example: 'submissions/usr_abc123/f47ac10b-58cc-4372-a567-0e02b2c3d479.jpg',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(
    // segment 0: folder   — lowercase letters only
    // segment 1: userId   — lowercase letters, digits, hyphens, underscores (Gap 9)
    // segment 2: filename — UUID hex chars + hyphens, dot, lowercase alnum extension
    /^[a-z]+\/[\w-]+\/[a-f0-9-]+\.[a-z0-9]+$/,
    { message: 'Invalid key format' },
  )
  key!: string;
}