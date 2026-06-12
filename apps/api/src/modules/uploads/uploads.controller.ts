import {
  Controller,
  Post,
  Body,
  UseGuards,
  Req,
  HttpCode,
  HttpStatus,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { Throttle } from '@nestjs/throttler';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { UploadsService, JwtPayload } from './uploads.service';
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

  // -------------------------------------------------------------------------
  // POST /uploads/presigned-url
  // Returns a presigned S3 POST url + policy fields for direct browser upload.
  // Gap 4  — userId extracted with typed JwtPayload; throws 401 if sub absent.
  // Gap 10 — response no longer includes an unsigned cdnUrl.
  // Gap 13 — throttle also applied here (unchanged from original).
  // -------------------------------------------------------------------------
  @Post('presigned-url')
  @Roles(Role.TEACHER, Role.STUDENT, Role.FAMILY)
  @Throttle({ default: { limit: 30, ttl: 60 } }) // 30 presign requests per minute
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get presigned S3 POST fields for direct browser upload',
    description:
      'Returns a `uploadUrl` and `fields` map. The client must submit a ' +
      '`multipart/form-data` POST to `uploadUrl`, appending every entry in ' +
      '`fields` before the file part. After the upload completes, call ' +
      '`POST /uploads/confirm` to receive the signed CDN URL.',
  })
  @ApiResponse({
    status: 200,
    description: 'Presigned POST data generated successfully',
    schema: {
      example: {
        success: true,
        data: {
          uploadUrl: 'https://my-bucket.s3.amazonaws.com/',
          fields: {
            'Content-Type': 'image/jpeg',
            key: 'submissions/usr_abc/uuid.jpg',
            Policy: '<base64-policy>',
            'X-Amz-Signature': '<sig>',
          },
          key: 'submissions/usr_abc/uuid.jpg',
          expiresAt: '2024-01-01T00:01:00.000Z',
        },
        error: null,
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Invalid request or file type not permitted' })
  @ApiResponse({ status: 401, description: 'Unauthorized or missing user identity' })
  @ApiResponse({ status: 429, description: 'Too many requests' })
  async getPresignedUrl(
    @Body() dto: PresignedUrlDto,
    @Req() req: Request,
  ) {
    // Gap 4 — type-safe extraction; guard against tokens missing `sub`
    const userId = extractUserId(req);
    return this.uploadsService.generatePresignedUrl(userId, dto);
  }

  // -------------------------------------------------------------------------
  // POST /uploads/confirm
  // Verifies the uploaded object in S3 and returns a signed CloudFront URL.
  // Gap 13 — rate-limited to 60 confirms per minute (was unlimited).
  // -------------------------------------------------------------------------
  @Post('confirm')
  @Roles(Role.TEACHER, Role.STUDENT, Role.FAMILY)
  @Throttle({ default: { limit: 60, ttl: 60 } }) // Gap 13 — 60 confirms per minute
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Confirm upload completion and get signed CDN URL' })
  @ApiResponse({
    status: 200,
    description: 'Upload confirmed successfully',
    schema: {
      example: {
        success: true,
        data: {
          confirmed: true,
          signedUrl: 'https://cdn.example.com/key?signature=…',
          key: 'submissions/usr_abc/uuid.jpg',
        },
        error: null,
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Invalid key, forbidden MIME type, or oversized object' })
  @ApiResponse({ status: 401, description: 'Unauthorized or missing user identity' })
  @ApiResponse({ status: 403, description: 'Key does not belong to user' })
  @ApiResponse({ status: 404, description: 'Upload not found in S3' })
  @ApiResponse({ status: 429, description: 'Too many requests' })
  async confirmUpload(
    @Body() dto: ConfirmUploadDto,
    @Req() req: Request,
  ) {
    const userId = extractUserId(req);
    return this.uploadsService.confirmUpload(userId, dto);
  }
}

// ---------------------------------------------------------------------------
// Gap 4 — shared helper: type-safe userId extraction with null guard.
//   Kept as a module-private function so both handlers share identical logic
//   without duplicating the guard or creating a separate interceptor.
// ---------------------------------------------------------------------------
function extractUserId(req: Request): string {
  const payload = req.user as JwtPayload | undefined;
  const sub = payload?.sub;
  if (!sub) {
    throw new UnauthorizedException('Missing user identity');
  }
  return sub;
}