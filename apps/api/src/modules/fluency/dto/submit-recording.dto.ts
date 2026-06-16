import { IsString, IsNotEmpty, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SubmitRecordingDto {
  @ApiProperty({
    description:
      'S3 key of the uploaded audio recording. Must follow the format: folder/userId/uuid.ext',
    example: 'fluency/student-uuid/recording-uuid.webm',
  })
  @IsString()
  @IsNotEmpty()
  // Matches: folder/userId/uuid.ext — same format enforced by UploadsService.generateKey
  @Matches(/^[a-z]+\/[a-z0-9-]+\/[a-f0-9-]+\.[a-z0-9]+$/, {
    message:
      'recording_key must be a valid S3 key in format: folder/userId/uuid.ext',
  })
  recording_key: string;
}
