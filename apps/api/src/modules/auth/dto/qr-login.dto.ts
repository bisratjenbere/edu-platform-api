import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class QrLoginDto {
  @ApiProperty({
    description: 'QR token for student login',
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
  })
  @IsString()
  @MinLength(1, { message: 'Token is required' })
  token!: string;
}
