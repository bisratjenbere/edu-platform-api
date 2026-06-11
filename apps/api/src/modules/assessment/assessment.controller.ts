import {
  Controller,
  Get,
  Patch,
  Post,
  Body,
  Param,
  UseGuards,
  Request,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { AssessmentService } from './assessment.service';
import { TeacherFeedbackDto, SaveAnnotationDto } from './dto';
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

@ApiTags('assessment')
@Controller('api/v1/assessment')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class AssessmentController {
  constructor(private readonly assessmentService: AssessmentService) {}

  @Get('activities/:id/submissions')
  @Roles(Role.TEACHER, Role.SCHOOL_ADMIN)
  @ApiOperation({
    summary: 'Get all submissions for an activity (teacher review panel)',
    description:
      'Returns all submissions with student info and block scores. Accessible by teachers (for their classes) and school admins (for safeguarding).',
  })
  @ApiResponse({
    status: 200,
    description: 'Submissions retrieved successfully',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - not your class' })
  @ApiResponse({ status: 404, description: 'Activity not found' })
  async getAllSubmissions(
    @Param('id') activityId: string,
    @Request() req: AuthenticatedRequest,
  ): Promise<ApiResponse<any[]>> {
    const submissions = await this.assessmentService.getAllSubmissions(
      activityId,
      req.user.id,
      req.user.role,
    );
    return { success: true, data: submissions, error: null };
  }

  @Patch('submissions/:id')
  @Roles(Role.TEACHER)
  @ApiOperation({
    summary: 'Update submission feedback (status + text/audio feedback)',
    description:
      'Teacher updates submission status to RETURNED or APPROVED with optional feedback. Triggers journal post creation on APPROVED.',
  })
  @ApiResponse({
    status: 200,
    description: 'Feedback updated successfully',
  })
  @ApiResponse({ status: 400, description: 'Invalid status or validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - not your class' })
  @ApiResponse({ status: 404, description: 'Submission not found' })
  async updateFeedback(
    @Param('id') submissionId: string,
    @Body() dto: TeacherFeedbackDto,
    @Request() req: AuthenticatedRequest,
  ): Promise<ApiResponse<any>> {
    const updated = await this.assessmentService.updateFeedback(
      submissionId,
      req.user.id,
      dto,
    );
    return { success: true, data: updated, error: null };
  }

  @Post('submissions/:id/annotate')
  @Roles(Role.TEACHER)
  @ApiOperation({
    summary: 'Save teacher annotation on a submission block',
    description:
      'Saves annotation JSON (drawing overlay, canvas markup) on a specific block.',
  })
  @ApiResponse({
    status: 200,
    description: 'Annotation saved successfully',
  })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - not your class' })
  @ApiResponse({ status: 404, description: 'Submission or block not found' })
  async saveAnnotation(
    @Param('id') submissionId: string,
    @Body() dto: SaveAnnotationDto,
    @Request() req: AuthenticatedRequest,
  ): Promise<ApiResponse<any>> {
    const updated = await this.assessmentService.saveAnnotation(
      submissionId,
      req.user.id,
      dto,
    );
    return { success: true, data: updated, error: null };
  }

  @Get('submissions/:id/annotation/:blockId')
  @Roles(Role.TEACHER)
  @ApiOperation({
    summary: 'Get annotation for a specific submission block',
    description: 'Returns the annotation JSON for the specified block.',
  })
  @ApiResponse({
    status: 200,
    description: 'Annotation retrieved successfully',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - not your class' })
  @ApiResponse({ status: 404, description: 'Submission or block not found' })
  async getAnnotation(
    @Param('id') submissionId: string,
    @Param('blockId') blockId: string,
    @Request() req: AuthenticatedRequest,
  ): Promise<ApiResponse<{ annotation_json: string | null }>> {
    const annotation = await this.assessmentService.getAnnotation(
      submissionId,
      blockId,
      req.user.id,
    );
    return { success: true, data: annotation, error: null };
  }

  @Get('classes/:classId/analytics')
  @Roles(Role.TEACHER)
  @ApiOperation({
    summary: 'Get class-level performance analytics',
    description:
      'Returns submission rate, average score, and score distribution for the class.',
  })
  @ApiResponse({
    status: 200,
    description: 'Analytics retrieved successfully',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - not your class' })
  async getClassAnalytics(
    @Param('classId') classId: string,
    @Request() req: AuthenticatedRequest,
  ): Promise<ApiResponse<any>> {
    const analytics = await this.assessmentService.getClassAnalytics(
      classId,
      req.user.id,
    );
    return { success: true, data: analytics, error: null };
  }

  @Get('students/:studentId/progress')
  @Roles(Role.TEACHER)
  @ApiOperation({
    summary: 'Get per-student progress over time',
    description:
      'Returns weekly submission counts (last 30 days) and per-standards-tag mastery percentages.',
  })
  @ApiResponse({
    status: 200,
    description: 'Progress retrieved successfully',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - student not in your class' })
  async getStudentProgress(
    @Param('studentId') studentId: string,
    @Request() req: AuthenticatedRequest,
  ): Promise<ApiResponse<any>> {
    const progress = await this.assessmentService.getStudentProgress(
      studentId,
      req.user.id,
    );
    return { success: true, data: progress, error: null };
  }
}
