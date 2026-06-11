import { IsOptional, IsString, IsInt, Min, Max, IsIn, IsArray } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class SearchTemplatesDto {
  @ApiPropertyOptional({ description: 'Search query string' })
  @IsOptional()
  @IsString()
  q?: string;

  @ApiPropertyOptional({ description: 'Filter by grade level' })
  @IsOptional()
  @IsString()
  grade?: string;

  @ApiPropertyOptional({ description: 'Filter by subject' })
  @IsOptional()
  @IsString()
  subject?: string;

  @ApiPropertyOptional({ description: 'Filter by standards tags', type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  standard?: string[];

  @ApiPropertyOptional({
    description: 'Sort order',
    enum: ['relevance', 'newest', 'highest_rated', 'most_used'],
    default: 'relevance',
  })
  @IsOptional()
  @IsIn(['relevance', 'newest', 'highest_rated', 'most_used'])
  sortBy?: 'relevance' | 'newest' | 'highest_rated' | 'most_used' = 'relevance';

  @ApiPropertyOptional({ description: 'Page number', minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ description: 'Results per page', minimum: 1, maximum: 50, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number = 20;
}
