import { IsInt, IsOptional, IsString, Min, Max } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RateTemplateDto {
  @ApiProperty({ description: 'Rating score (1-5 stars)', minimum: 1, maximum: 5 })
  @IsInt()
  @Min(1)
  @Max(5)
  score!: number;

  @ApiPropertyOptional({ description: 'Optional review text' })
  @IsOptional()
  @IsString()
  review?: string;
}
