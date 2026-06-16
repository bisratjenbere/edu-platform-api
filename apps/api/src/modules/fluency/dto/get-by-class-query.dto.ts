import { IsOptional, IsUUID, IsEnum } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { FluencyStatus } from '@prisma/client';

export class GetByClassQueryDto {
  @ApiPropertyOptional({
    description: 'Filter results to a specific student',
    format: 'uuid',
  })
  @IsOptional()
  @IsUUID()
  studentId?: string;

  @ApiPropertyOptional({
    description: 'Filter results by assessment status',
    enum: FluencyStatus,
  })
  @IsOptional()
  @IsEnum(FluencyStatus)
  status?: FluencyStatus;
}
