import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsUUID, IsNotEmpty, MaxLength } from 'class-validator';

export class SaveAnnotationDto {
  @ApiProperty({
    description: 'Block ID to annotate',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsUUID()
  @IsNotEmpty()
  block_id!: string;

  @ApiProperty({
    description: 'Annotation JSON data (drawing overlay, canvas markup, etc.)',
    example: '{"type":"canvas","strokes":[{"color":"#FF0000","points":[100,100,150,150]}]}',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100000)
  annotation_json!: string;
}
