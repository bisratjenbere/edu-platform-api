import { ApiProperty } from '@nestjs/swagger';

export class BulkImportResultDto {
  @ApiProperty({
    description: 'Number of users successfully created',
    example: 25,
  })
  added!: number;

  @ApiProperty({
    description: 'Number of existing users updated',
    example: 5,
  })
  updated!: number;

  @ApiProperty({
    description: 'Array of error messages for failed rows',
    example: ['Row 3: Invalid email format', 'Row 7: Role must be TEACHER or STUDENT'],
    type: [String],
  })
  errors!: string[];
}

export class BulkImportErrorDto {
  @ApiProperty({
    description: 'Row number (1-indexed)',
    example: 3,
  })
  row!: number;

  @ApiProperty({
    description: 'Error message',
    example: 'Invalid email format',
  })
  message!: string;
}
