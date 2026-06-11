import {
  Controller,
  Post,
  Delete,
  Body,
  Param,
  UseGuards,
  Req,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { Role } from '@prisma/client';
import { NotificationsService } from './notifications.service';
import { RegisterDeviceDto } from './dto';

@ApiTags('devices')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('devices')
export class DevicesController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Post('register')
  @Roles(Role.TEACHER, Role.STUDENT, Role.FAMILY)
  @ApiOperation({ summary: 'Register a device for push notifications' })
  @ApiResponse({ status: 201, description: 'Device registered successfully' })
  @ApiResponse({ status: 400, description: 'Invalid device token or platform' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async registerDevice(
    @Req() req: any,
    @Body() dto: RegisterDeviceDto,
  ): Promise<{ success: boolean; data: null; error: null }> {
    await this.notificationsService.registerDevice(req.user.id, dto);
    return {
      success: true,
      data: null,
      error: null,
    };
  }

  @Delete(':token')
  @Roles(Role.TEACHER, Role.STUDENT, Role.FAMILY)
  @ApiOperation({ summary: 'Unregister a device token' })
  @ApiResponse({ status: 200, description: 'Device unregistered successfully' })
  @ApiResponse({ status: 403, description: 'You do not own this device' })
  @ApiResponse({ status: 404, description: 'Device not found' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async unregisterDevice(
    @Req() req: any,
    @Param('token') token: string,
  ): Promise<{ success: boolean; data: null; error: null }> {
    await this.notificationsService.unregisterDevice(req.user.id, token);
    return {
      success: true,
      data: null,
      error: null,
    };
  }
}
