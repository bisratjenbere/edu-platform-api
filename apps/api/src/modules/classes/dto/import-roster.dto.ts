import { ApiProperty } from '@nestjs/swagger';

export class ImportRosterDto {
  @ApiProperty({ 
    type: 'string', 
    format: 'binary',
    description: 'CSV file with columns: firstName, lastName, email, gradeLevel (optional)'
  })
  file!: any; // Using any for Multer.File to avoid type issues
}
