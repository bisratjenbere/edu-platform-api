import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, MaxLength, IsEnum } from 'class-validator';
import { Platform } from '@prisma/client';

export class RegisterDeviceDto {
  @ApiProperty({
    description: 'FCM or APNs device token',
    example: 'dGhpcyBpcyBhIGZha2UgdG9rZW4gZm9yIGV4YW1wbGU=',
    maxLength: 500,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  token!: string;

  @ApiProperty({
    description: 'Device platform',
    enum: Platform,
    example: Platform.IOS,
  })
  @IsEnum(Platform)
  platform!: Platform;
}
