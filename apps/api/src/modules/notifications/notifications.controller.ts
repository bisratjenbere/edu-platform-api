import {
  Controller,
  Get,
  Patch,
  Body,
  UseGuards,
  Request,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { NotificationsService } from './notifications.service';
import { UpdatePreferencesDto } from './dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { Role, NotificationType } from '@prisma/client';

interface AuthenticatedRequest extends Request {
  user: {
    id: string;
    role: Role;
  };
}

interface ApiResponseEnvelope<T> {
  success: boolean;
  data: T | null;
  error: string | null;
}

interface NotificationPreferenceItem {
  type: NotificationType;
  enabled: boolean;
}

@ApiTags('notifications')
@Controller('api/v1/notifications')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get('preferences')
  @Roles(Role.TEACHER, Role.STUDENT, Role.FAMILY)
  @ApiOperation({
    summary: 'Get notification preferences',
    description:
      'Returns all notification types with user preferences (defaults to enabled for missing types)',
  })
  @ApiResponse({
    status: 200,
    description: 'Preferences retrieved successfully',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getPreferences(
    @Request() req: AuthenticatedRequest,
  ): Promise<ApiResponseEnvelope<NotificationPreferenceItem[]>> {
    const preferences = await this.notificationsService.getPreferences(
      req.user.id,
    );
    return { success: true, data: preferences, error: null };
  }

  @Patch('preferences')
  @Roles(Role.TEACHER, Role.STUDENT, Role.FAMILY)
  @ApiOperation({
    summary: 'Update notification preferences',
    description: 'Bulk update notification preferences for the authenticated user',
  })
  @ApiResponse({
    status: 200,
    description: 'Preferences updated successfully',
  })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async updatePreferences(
    @Body() dto: UpdatePreferencesDto,
    @Request() req: AuthenticatedRequest,
  ): Promise<ApiResponseEnvelope<void>> {
    await this.notificationsService.updatePreferences(req.user.id, dto);
    return { success: true, data: null, error: null };
  }
}
