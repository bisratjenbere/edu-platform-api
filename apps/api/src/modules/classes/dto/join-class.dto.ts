import { IsString, Length, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class JoinClassDto {
  @ApiProperty({ example: 'ABC123', description: '6-character alphanumeric class code' })
  @IsString()
  @Length(6, 6)
  @Matches(/^[A-Z0-9]{6}$/, { message: 'Code must be 6 uppercase alphanumeric characters' })
  code!: string;
}
