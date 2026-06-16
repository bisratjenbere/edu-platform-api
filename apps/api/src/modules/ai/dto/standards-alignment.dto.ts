import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class StandardsAlignmentDto {
  @ApiProperty({
    description: 'Activity ID to analyze for standards alignment',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsUUID()
  activityId!: string;
}

export class StandardsAlignmentItemDto {
  @ApiProperty({ example: 'NGSS.3-LS1-1' })
  standardCode!: string;

  @ApiProperty({ example: 'Construct an argument that plants and animals have internal and external structures...' })
  standardDescription!: string;

  @ApiProperty({ description: 'How strongly this activity aligns: high | medium | low' })
  alignmentStrength!: 'high' | 'medium' | 'low';

  @ApiProperty({ description: 'Which blocks in the activity provide evidence for this alignment' })
  evidenceFromBlocks!: string[];
}

export class StandardsAlignmentResponseDto {
  @ApiProperty({ type: [StandardsAlignmentItemDto] })
  suggestedStandards!: StandardsAlignmentItemDto[];

  @ApiProperty({ description: 'Subject area inferred from the activity content' })
  inferredSubject!: string;

  @ApiProperty({ description: 'Grade level inferred or confirmed from the activity' })
  inferredGradeLevel!: string;

  @ApiProperty({ description: 'Flat list of standard codes for easy copy into standards_tags' })
  standardCodes!: string[];
}