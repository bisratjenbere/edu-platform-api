import { IsEmail, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateFamilyInviteDto {
  @ApiProperty({ example: 'parent@example.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440000' })
  @IsUUID()
  student_id!: string;
}
