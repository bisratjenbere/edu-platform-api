import { IsEmail } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AddCoTeacherDto {
  @ApiProperty({ example: 'john.doe@school.edu' })
  @IsEmail()
  email!: string;
}
