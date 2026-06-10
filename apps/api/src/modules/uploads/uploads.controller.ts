import {
  Controller,
  Post,
  Body,
  UseGuards,
  Req,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Request } from 'express';
import { Throttle } from '@nestjs/throttler';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { UploadsService } from './uploads.service';
import { PresignedUrlDto, ConfirmUploadDto } from './dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { Role } from '@prisma/client';

@ApiTags('uploads')
@Controller('uploads')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class UploadsController {
  constructor(private readonly uploadsService: UploadsService) {}

  @Post('presigned-url')
  @Roles(Role.TEACHER, Role.STUDENT, Role.FAMILY)
  @Throttle({ default: { limit: 30, ttl: 60 } }) // 30 uploads per minute
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get presigned S3 URL for direct upload' })
  @ApiResponse({
    status: 200,
    description: 'Presigned URL generated successfully',
  })
  @ApiResponse({ status: 400, description: 'Invalid request or file type not permitted' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 429, description: 'Too many requests' })
  async getPresignedUrl(
    @Body() dto: PresignedUrlDto,
    @Req() req: Request,
  ) {
    const user = req.user as any;
    const userId = user?.sub;

    return this.uploadsService.generatePresignedUrl(userId, dto);
  }

  @Post('confirm')
  @Roles(Role.TEACHER, Role.STUDENT, Role.FAMILY)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Confirm upload completion and get signed CDN URL' })
  @ApiResponse({
    status: 200,
    description: 'Upload confirmed successfully',
  })
  @ApiResponse({ status: 400, description: 'Invalid key format' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Key does not belong to user' })
  @ApiResponse({ status: 404, description: 'Upload not found in S3' })
  async confirmUpload(
    @Body() dto: ConfirmUploadDto,
    @Req() req: Request,
  ) {
    const user = req.user as any;
    const userId = user?.sub;

    return this.uploadsService.confirmUpload(userId, dto);
  }
}
