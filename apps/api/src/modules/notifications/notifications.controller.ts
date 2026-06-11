import {
  Controller,
  Get,
  Patch,
  Body,
  UseGuards,
  Req,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { Role, NotificationType } from '@prisma/client';
import { NotificationsService } from './notifications.service';
import { UpdatePreferencesDto } from './dto';

interface PreferenceResponse {
  type: NotificationType;
  enabled: boolean;
}

@ApiTags('notifications')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get('preferences')
  @Roles(Role.TEACHER, Role.STUDENT, Role.FAMILY)
  @ApiOperation({ summary: 'Get notification preferences for the current user' })
  @ApiResponse({
    status: 200,
    description: 'Notification preferences retrieved',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        data: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              type: { type: 'string', enum: Object.values(NotificationType) },
              enabled: { type: 'boolean' },
            },
          },
        },
        error: { type: 'null' },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getPreferences(
    @Req() req: any,
  ): Promise<{
    success: boolean;
    data: PreferenceResponse[];
    error: null;
  }> {
    const preferences = await this.notificationsService.getPreferences(
      req.user.id,
    );
    return {
      success: true,
      data: preferences,
      error: null,
    };
  }

  @Patch('preferences')
  @Roles(Role.TEACHER, Role.STUDENT, Role.FAMILY)
  @ApiOperation({ summary: 'Update notification preferences' })
  @ApiResponse({ status: 200, description: 'Preferences updated successfully' })
  @ApiResponse({ status: 400, description: 'Invalid preference data' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async updatePreferences(
    @Req() req: any,
    @Body() dto: UpdatePreferencesDto,
  ): Promise<{ success: boolean; data: null; error: null }> {
    await this.notificationsService.updatePreferences(req.user.id, dto);
    return {
      success: true,
      data: null,
      error: null,
    };
  }
}
