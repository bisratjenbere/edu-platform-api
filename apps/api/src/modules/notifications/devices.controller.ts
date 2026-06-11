import {
  Controller,
  Post,
  Delete,
  Body,
  Param,
  UseGuards,
  Request,
  HttpCode,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { NotificationsService } from './notifications.service';
import { RegisterDeviceDto } from './dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { Role } from '@prisma/client';

interface AuthenticatedRequest extends Request {
  user: {
    id: string;
    role: Role;
  };
}

interface ApiResponse<T> {
  success: boolean;
  data: T | null;
  error: string | null;
}

@ApiTags('devices')
@Controller('api/v1/devices')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class DevicesController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Post('register')
  @Roles(Role.TEACHER, Role.STUDENT, Role.FAMILY)
  @ApiOperation({
    summary: 'Register device for push notifications',
    description: 'Upserts FCM/APNs device token for the authenticated user',
  })
  @ApiResponse({
    status: 200,
    description: 'Device registered successfully',
  })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async registerDevice(
    @Body() dto: RegisterDeviceDto,
    @Request() req: AuthenticatedRequest,
  ): Promise<ApiResponse<void>> {
    await this.notificationsService.registerDevice(req.user.id, dto);
    return { success: true, data: null, error: null };
  }

  @Delete(':token')
  @Roles(Role.TEACHER, Role.STUDENT, Role.FAMILY)
  @HttpCode(204)
  @ApiOperation({
    summary: 'Unregister device token',
    description: 'Removes device token from the system. User must own the device.',
  })
  @ApiResponse({
    status: 204,
    description: 'Device unregistered successfully',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - not your device' })
  @ApiResponse({ status: 404, description: 'Device not found' })
  async unregisterDevice(
    @Param('token') token: string,
    @Request() req: AuthenticatedRequest,
  ): Promise<void> {
    await this.notificationsService.unregisterDevice(req.user.id, token);
  }
}
