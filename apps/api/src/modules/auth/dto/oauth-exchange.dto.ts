import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class OAuthExchangeDto {
  @ApiProperty({ description: 'One-time OAuth exchange code from callback redirect' })
  @IsString()
  @MinLength(16, { message: 'Invalid exchange code' })
  code!: string;
}
