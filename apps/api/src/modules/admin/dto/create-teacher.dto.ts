import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, IsUUID, MaxLength, IsNotEmpty } from 'class-validator';

export class CreateTeacherDto {
  @ApiProperty({
    description: 'Teacher email address',
    example: 'jane.smith@school.edu',
  })
  @IsEmail()
  @IsNotEmpty()
  email!: string;

  @ApiProperty({
    description: 'Teacher first name',
    example: 'Jane',
    maxLength: 100,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  firstName!: string;

  @ApiProperty({
    description: 'Teacher last name',
    example: 'Smith',
    maxLength: 100,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  lastName!: string;

  @ApiProperty({
    description: 'School ID to assign teacher to',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsUUID()
  @IsNotEmpty()
  schoolId!: string;
}
