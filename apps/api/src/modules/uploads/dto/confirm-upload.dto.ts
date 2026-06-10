import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, Matches } from 'class-validator';

export class ConfirmUploadDto {
  @ApiProperty({
    description: 'S3 object key returned from presigned-url step',
    example: 'submissions/usr_abc123/f47ac10b-58cc-4372-a567-0e02b2c3d479.jpg',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^[a-z]+\/[a-z0-9-]+\/[a-f0-9-]+\.[a-z0-9]+$/, {
    message: 'Invalid key format',
  })
  key!: string;
}
