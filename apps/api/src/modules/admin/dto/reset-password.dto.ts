import { ApiProperty } from '@nestjs/swagger';

/**
 * Reset password DTO — no body required
 * Server generates a temporary password and sends it via email
 */
export class ResetPasswordResponseDto {
  @ApiProperty({
    description: 'Indicates password was successfully reset',
    example: true,
  })
  success!: boolean;

  @ApiProperty({
    description: 'Confirmation message',
    example: 'Temporary password sent to teacher@school.edu',
  })
  message!: string;
}
