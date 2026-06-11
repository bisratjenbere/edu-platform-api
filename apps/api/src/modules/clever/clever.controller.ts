import {
  Controller,
  Get,
  Post,
  Param,
  UseGuards,
  Req,
  Res,
  Logger,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { CleverService } from './clever.service';
import { CleverRosterSyncService, CleverSyncResult } from './clever-roster-sync.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { Role } from '@prisma/client';

@ApiTags('clever')
@Controller('clever')
export class CleverController {
  private readonly logger = new Logger(CleverController.name);

  constructor(
    private cleverService: CleverService,
    private cleverSyncService: CleverRosterSyncService,
  ) {}

  @Get('auth/clever')
  @UseGuards(AuthGuard('clever'))
  @ApiOperation({ summary: 'Initiate Clever OAuth login' })
  @ApiResponse({ status: 302, description: 'Redirect to Clever OAuth page' })
  async cleverLogin() {
    // Passport handles the redirect
  }

  @Get('auth/clever/callback')
  @UseGuards(AuthGuard('clever'))
  @ApiOperation({ summary: 'Clever OAuth callback' })
  @ApiResponse({ status: 302, description: 'Redirect to app with tokens' })
  async cleverCallback(@Req() req: Request, @Res() res: Response) {
    try {
      const cleverProfile = req.user as any;
      
      const { user, isNew, accessToken, refreshToken } =
        await this.cleverService.handleCallback(cleverProfile);

      // Set refresh token as HttpOnly cookie
      res.cookie('__rt', refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      });

      this.logger.log(
        `Clever login successful for user ${user.id} (${isNew ? 'new' : 'existing'})`,
      );

      // Redirect to frontend with access token
      const redirectUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
      res.redirect(`${redirectUrl}/auth/callback?token=${accessToken}`);
    } catch (error) {
      this.logger.error('Clever callback failed', error);
      const redirectUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
      res.redirect(`${redirectUrl}/auth/callback?error=${encodeURIComponent(error instanceof Error ? error.message : 'Login failed')}`);
    }
  }

  @Post('sync')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SCHOOL_ADMIN, Role.DISTRICT_ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Trigger manual Clever roster sync' })
  @ApiResponse({
    status: 201,
    description: 'Sync job enqueued',
    schema: {
      example: { success: true, data: { jobId: 'abc123', status: 'QUEUED' }, error: null },
    },
  })
  @ApiResponse({ status: 409, description: 'Sync already in progress' })
  async triggerSync(@Req() req: any) {
    const user = req.user;
    const schoolId = user.school_id;

    const result = await this.cleverSyncService.enqueueSync(schoolId, 'MANUAL');

    return {
      success: true,
      data: result,
      error: null,
    };
  }

  @Get('sync/:jobId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SCHOOL_ADMIN, Role.DISTRICT_ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get sync job status' })
  @ApiResponse({
    status: 200,
    description: 'Job status retrieved',
    schema: {
      example: {
        success: true,
        data: { jobId: 'abc123', status: 'COMPLETED', result: {} },
        error: null,
      },
    },
  })
  @ApiResponse({ status: 404, description: 'Job not found' })
  async getSyncStatus(@Param('jobId') jobId: string) {
    const result = await this.cleverSyncService.getSyncStatus(jobId);

    return {
      success: true,
      data: result,
      error: null,
    };
  }

  @Get('sync/status/latest')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SCHOOL_ADMIN, Role.DISTRICT_ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get last sync summary for school' })
  @ApiResponse({
    status: 200,
    description: 'Last sync summary',
    schema: {
      example: {
        success: true,
        data: {
          lastSyncAt: '2026-01-01T02:00:00Z',
          lastSyncStatus: 'SUCCESS',
          summary: { added: 5, updated: 10, deactivated: 2 },
        },
        error: null,
      },
    },
  })
  async getLastSyncSummary(@Req() req: any) {
    const user = req.user;
    const schoolId = user.school_id;

    const result = await this.cleverSyncService.getLastSyncSummary(schoolId);

    if (!result) {
      return {
        success: true,
        data: {
          lastSyncAt: null,
          lastSyncStatus: null,
          summary: null,
        },
        error: null,
      };
    }

    return {
      success: true,
      data: {
        lastSyncAt: result.completedAt,
        lastSyncStatus: result.status,
        summary: {
          added: result.added,
          updated: result.updated,
          deactivated: result.deactivated,
        },
      },
      error: null,
    };
  }
}
