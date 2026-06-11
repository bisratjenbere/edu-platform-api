import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
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
import { Role } from '@prisma/client';
import { SubmissionsService } from './submissions.service';
import { UpdateSubmissionBlockDto, TeacherFeedbackDto } from './dto';

interface RequestWithUser extends Request {
  user: {
    id: string;
    email: string;
    role: Role;
  };
}

@ApiTags('submissions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('submissions')
export class SubmissionsController {
  constructor(private submissionsService: SubmissionsService) {}

  @Get()
  @Roles(Role.STUDENT)
  @ApiOperation({ summary: 'Get student inbox (assigned activities)' })
  @ApiQuery({ name: 'classId', required: false })
  @ApiResponse({ status: 200, description: 'Inbox retrieved successfully' })
  async getInbox(
    @Request() req: RequestWithUser,
    @Query('classId') classId?: string,
  ) {
    const inbox = await this.submissionsService.getInbox(
      req.user.id,
      classId,
    );
    return {
      success: true,
      data: inbox,
      error: null,
    };
  }

  @Get(':id')
  @Roles(Role.STUDENT, Role.TEACHER, Role.FAMILY)
  @ApiOperation({ summary: 'Get submission with all blocks' })
  @ApiParam({ name: 'id', description: 'Submission ID' })
  @ApiResponse({ status: 200, description: 'Submission retrieved successfully' })
  @ApiResponse({ status: 404, description: 'Submission not found' })
  async findOne(@Request() req: RequestWithUser, @Param('id') id: string) {
    const submission = await this.submissionsService.findOne(id, req.user.id);
    return {
      success: true,
      data: submission,
      error: null,
    };
  }

  @Post(':id/start')
  @Roles(Role.STUDENT)
  @ApiOperation({ summary: 'Start working on submission (status → IN_PROGRESS)' })
  @ApiParam({ name: 'id', description: 'Submission ID' })
  @ApiResponse({ status: 200, description: 'Submission started successfully' })
  @ApiResponse({ status: 400, description: 'Submission already started' })
  async start(@Request() req: RequestWithUser, @Param('id') id: string) {
    const submission = await this.submissionsService.start(id, req.user.id);
    return {
      success: true,
      data: submission,
      error: null,
    };
  }

  @Patch(':id/blocks/:blockId')
  @Roles(Role.STUDENT)
  @ApiOperation({ summary: 'Save block response (auto-save draft)' })
  @ApiParam({ name: 'id', description: 'Submission ID' })
  @ApiParam({ name: 'blockId', description: 'Block ID' })
  @ApiResponse({ status: 200, description: 'Block response saved successfully' })
  async saveBlock(
    @Request() req: RequestWithUser,
    @Param('id') submissionId: string,
    @Param('blockId') blockId: string,
    @Body() dto: Omit<UpdateSubmissionBlockDto, 'block_id'>,
  ) {
    const fullDto: UpdateSubmissionBlockDto = {
      block_id: blockId,
      response_content: dto.response_content,
    };
    const block = await this.submissionsService.saveBlock(
      submissionId,
      req.user.id,
      fullDto,
    );
    return {
      success: true,
      data: block,
      error: null,
    };
  }

  @Post(':id/submit')
  @Roles(Role.STUDENT)
  @ApiOperation({
    summary: 'Submit for grading (status → SUBMITTED, triggers auto-grade)',
  })
  @ApiParam({ name: 'id', description: 'Submission ID' })
  @ApiResponse({
    status: 200,
    description: 'Submission submitted and graded successfully',
  })
  @ApiResponse({
    status: 400,
    description: 'Submission not in IN_PROGRESS status',
  })
  async submit(@Request() req: RequestWithUser, @Param('id') id: string) {
    const submission = await this.submissionsService.submit(id, req.user.id);
    return {
      success: true,
      data: submission,
      error: null,
    };
  }

  @Patch(':id')
  @Roles(Role.TEACHER)
  @ApiOperation({ summary: 'Update submission status and provide feedback' })
  @ApiParam({ name: 'id', description: 'Submission ID' })
  @ApiResponse({ status: 200, description: 'Feedback saved successfully' })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - Not authorized for this submission',
  })
  async updateFeedback(
    @Request() req: RequestWithUser,
    @Param('id') id: string,
    @Body() dto: TeacherFeedbackDto,
  ) {
    const submission = await this.submissionsService.updateFeedback(
      id,
      req.user.id,
      dto,
    );
    return {
      success: true,
      data: submission,
      error: null,
    };
  }
}
