import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
  Put,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
  ApiParam,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { Role, ActivityStatus } from '@prisma/client';
import { ActivitiesService } from './activities.service';
import { BlocksService } from './blocks.service';
import {
  CreateActivityDto,
  UpdateActivityDto,
  CreateBlockDto,
  UpdateBlockDto,
  AssignIndividualDto,
} from './dto';

interface RequestWithUser extends Request {
  user: {
    id: string;
    email: string;
    role: Role;
  };
}

@ApiTags('activities')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('activities')
export class ActivitiesController {
  constructor(
    private activitiesService: ActivitiesService,
    private blocksService: BlocksService,
  ) {}

  @Post()
  @Roles(Role.TEACHER)
  @ApiOperation({ summary: 'Create a new activity as DRAFT' })
  @ApiResponse({ status: 201, description: 'Activity created successfully' })
  @ApiResponse({ status: 403, description: 'Forbidden - Not authorized for this class' })
  async create(
    @Request() req: RequestWithUser,
    @Body() dto: CreateActivityDto,
  ) {
    const activity = await this.activitiesService.create(req.user.id, dto);
    return {
      success: true,
      data: activity,
      error: null,
    };
  }

  @Get()
  @Roles(Role.TEACHER, Role.STUDENT)
  @ApiOperation({ summary: 'List activities for a class' })
  @ApiQuery({ name: 'classId', required: true })
  @ApiQuery({ name: 'status', required: false, enum: ActivityStatus })
  @ApiResponse({ status: 200, description: 'Activities retrieved successfully' })
  async findAll(
    @Request() req: RequestWithUser,
    @Query('classId') classId: string,
    @Query('status') status?: ActivityStatus,
  ) {
    const activities = await this.activitiesService.findAll(
      req.user.id,
      classId,
      status,
    );
    return {
      success: true,
      data: activities,
      error: null,
    };
  }

  @Get(':id')
  @Roles(Role.TEACHER, Role.STUDENT)
  @ApiOperation({ summary: 'Get activity with all blocks' })
  @ApiParam({ name: 'id', description: 'Activity ID' })
  @ApiResponse({ status: 200, description: 'Activity retrieved successfully' })
  @ApiResponse({ status: 404, description: 'Activity not found' })
  async findOne(@Request() req: RequestWithUser, @Param('id') id: string) {
    const activity = await this.activitiesService.findOne(id, req.user.id);
    return {
      success: true,
      data: activity,
      error: null,
    };
  }

  @Patch(':id')
  @Roles(Role.TEACHER)
  @ApiOperation({ summary: 'Update activity metadata' })
  @ApiParam({ name: 'id', description: 'Activity ID' })
  @ApiResponse({ status: 200, description: 'Activity updated successfully' })
  @ApiResponse({ status: 404, description: 'Activity not found' })
  async update(
    @Request() req: RequestWithUser,
    @Param('id') id: string,
    @Body() dto: UpdateActivityDto,
  ) {
    const activity = await this.activitiesService.update(
      id,
      req.user.id,
      dto,
    );
    return {
      success: true,
      data: activity,
      error: null,
    };
  }

  @Post(':id/publish')
  @Roles(Role.TEACHER)
  @ApiOperation({ summary: 'Validate and publish activity' })
  @ApiParam({ name: 'id', description: 'Activity ID' })
  @ApiResponse({ status: 200, description: 'Activity published successfully' })
  @ApiResponse({ status: 400, description: 'Validation failed - missing required block content' })
  async publish(@Request() req: RequestWithUser, @Param('id') id: string) {
    const activity = await this.activitiesService.publish(id, req.user.id);
    return {
      success: true,
      data: activity,
      error: null,
    };
  }

  @Post(':id/duplicate')
  @Roles(Role.TEACHER)
  @ApiOperation({ summary: 'Deep copy activity to target class' })
  @ApiParam({ name: 'id', description: 'Activity ID to duplicate' })
  @ApiResponse({ status: 201, description: 'Activity duplicated successfully' })
  async duplicate(
    @Request() req: RequestWithUser,
    @Param('id') id: string,
    @Body('targetClassId') targetClassId: string,
  ) {
    const activity = await this.activitiesService.duplicate(
      id,
      req.user.id,
      targetClassId,
    );
    return {
      success: true,
      data: activity,
      error: null,
    };
  }

  @Delete(':id')
  @Roles(Role.TEACHER)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Soft delete activity (PRIMARY teacher only)' })
  @ApiParam({ name: 'id', description: 'Activity ID' })
  @ApiResponse({ status: 204, description: 'Activity deleted successfully' })
  @ApiResponse({ status: 403, description: 'Forbidden - Only PRIMARY teacher can delete' })
  async remove(@Request() req: RequestWithUser, @Param('id') id: string) {
    await this.activitiesService.softDelete(id, req.user.id);
  }

  @Post(':id/blocks')
  @Roles(Role.TEACHER)
  @ApiOperation({ summary: 'Add a block to activity' })
  @ApiParam({ name: 'id', description: 'Activity ID' })
  @ApiResponse({ status: 201, description: 'Block added successfully' })
  @ApiResponse({ status: 400, description: 'Validation failed - invalid block content' })
  async addBlock(
    @Request() req: RequestWithUser,
    @Param('id') activityId: string,
    @Body() dto: CreateBlockDto,
  ) {
    const block = await this.blocksService.addBlock(
      activityId,
      req.user.id,
      dto,
    );
    return {
      success: true,
      data: block,
      error: null,
    };
  }

  @Put(':id/blocks')
  @Roles(Role.TEACHER)
  @ApiOperation({ summary: 'Replace all blocks (for drag-and-drop reorder)' })
  @ApiParam({ name: 'id', description: 'Activity ID' })
  @ApiResponse({ status: 200, description: 'Blocks replaced successfully' })
  async replaceAllBlocks(
    @Request() req: RequestWithUser,
    @Param('id') activityId: string,
    @Body('blocks') blocks: CreateBlockDto[],
  ) {
    const updatedBlocks = await this.blocksService.replaceAllBlocks(
      activityId,
      req.user.id,
      blocks,
    );
    return {
      success: true,
      data: updatedBlocks,
      error: null,
    };
  }

  @Patch(':id/blocks/:blockId')
  @Roles(Role.TEACHER)
  @ApiOperation({ summary: 'Update single block content' })
  @ApiParam({ name: 'id', description: 'Activity ID' })
  @ApiParam({ name: 'blockId', description: 'Block ID' })
  @ApiResponse({ status: 200, description: 'Block updated successfully' })
  async updateBlock(
    @Request() req: RequestWithUser,
    @Param('id') activityId: string,
    @Param('blockId') blockId: string,
    @Body() dto: UpdateBlockDto,
  ) {
    const block = await this.blocksService.updateBlock(
      activityId,
      blockId,
      req.user.id,
      dto,
    );
    return {
      success: true,
      data: block,
      error: null,
    };
  }

  @Delete(':id/blocks/:blockId')
  @Roles(Role.TEACHER)
  @ApiOperation({ summary: 'Remove block and reorder remaining blocks' })
  @ApiParam({ name: 'id', description: 'Activity ID' })
  @ApiParam({ name: 'blockId', description: 'Block ID' })
  @ApiResponse({ status: 200, description: 'Block removed successfully' })
  async removeBlock(
    @Request() req: RequestWithUser,
    @Param('id') activityId: string,
    @Param('blockId') blockId: string,
  ) {
    const result = await this.blocksService.removeBlock(
      activityId,
      blockId,
      req.user.id,
    );
    return {
      success: true,
      data: result,
      error: null,
    };
  }

  @Post(':id/assign-individual')
  @Roles(Role.TEACHER)
  @ApiOperation({ summary: 'Assign activity to specific students' })
  @ApiParam({ name: 'id', description: 'Activity ID' })
  @ApiResponse({ status: 200, description: 'Students assigned successfully' })
  @ApiResponse({
    status: 400,
    description: 'Activity must have assigned_to=INDIVIDUAL',
  })
  async assignIndividual(
    @Request() req: RequestWithUser,
    @Param('id') activityId: string,
    @Body() dto: AssignIndividualDto,
  ) {
    await this.activitiesService.assignIndividual(
      activityId,
      req.user.id,
      dto.student_ids,
      dto.custom_instructions,
    );
    return {
      success: true,
      data: { message: 'Students assigned successfully' },
      error: null,
    };
  }

  @Get(':id/submission-status')
  @Roles(Role.TEACHER)
  @ApiOperation({ summary: 'Get all student submission statuses for activity' })
  @ApiParam({ name: 'id', description: 'Activity ID' })
  @ApiResponse({ status: 200, description: 'Submission statuses retrieved successfully' })
  async getSubmissionStatus(
    @Request() req: RequestWithUser,
    @Param('id') activityId: string,
  ) {
    const statuses = await this.activitiesService.getSubmissionStatus(
      activityId,
      req.user.id,
    );
    return {
      success: true,
      data: statuses,
      error: null,
    };
  }
}
