import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { FluencyService } from './fluency.service';
import { CreateAssessmentDto, SubmitRecordingDto, GetByClassQueryDto } from './dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { Role, FluencyStatus } from '@prisma/client';

@ApiTags('fluency')
@Controller('api/v1/fluency')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class FluencyController {
  constructor(private readonly fluencyService: FluencyService) {}

  // ─── POST /api/v1/fluency/assessments ─────────────────────────────────────

  @Post('assessments')
  @Roles(Role.TEACHER)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create a fluency assessment (teacher only)',
    description:
      'Teacher creates a reading passage assessment for a student. ' +
      'passage_text must be 20–500 words.',
  })
  @ApiResponse({ status: 201, description: 'Assessment created' })
  @ApiResponse({
    status: 400,
    description: 'Validation error (word count, invalid student/class)',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Not a teacher of this class' })
  async create(@Request() req: any, @Body() dto: CreateAssessmentDto) {
    const assessment = await this.fluencyService.create(req.user.id, dto);
    return { success: true, data: assessment, error: null };
  }

  // ─── POST /api/v1/fluency/assessments/:id/recording ───────────────────────

  @Post('assessments/:id/recording')
  @Roles(Role.STUDENT)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Submit recording for a fluency assessment (student only)',
    description:
      'Student provides the S3 key of their uploaded audio recording. ' +
      'Status transitions to PROCESSING and analysis is enqueued immediately.',
  })
  @ApiParam({ name: 'id', description: 'Assessment UUID' })
  @ApiResponse({ status: 200, description: 'Recording accepted, analysis enqueued' })
  @ApiResponse({ status: 400, description: 'Invalid S3 key or key ownership mismatch' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Not the student for this assessment' })
  @ApiResponse({ status: 404, description: 'Assessment not found' })
  @ApiResponse({ status: 409, description: 'Recording already submitted' })
  async submitRecording(
    @Request() req: any,
    @Param('id') id: string,
    @Body() dto: SubmitRecordingDto,
  ) {
    const assessment = await this.fluencyService.submitRecording(
      id,
      req.user.id,
      dto,
    );
    return { success: true, data: assessment, error: null };
  }

  // ─── GET /api/v1/fluency/assessments/:id ─────────────────────────────────

  @Get('assessments/:id')
  @Roles(Role.TEACHER, Role.STUDENT)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get a single fluency assessment with full analysis',
    description:
      'Teachers can view any assessment in their class. ' +
      'Students can only view their own assessment.',
  })
  @ApiParam({ name: 'id', description: 'Assessment UUID' })
  @ApiResponse({ status: 200, description: 'Assessment returned with analysis JSON' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Access denied' })
  @ApiResponse({ status: 404, description: 'Assessment not found' })
  async getAssessment(@Request() req: any, @Param('id') id: string) {
    const assessment = await this.fluencyService.getAssessment(
      id,
      req.user.id,
      req.user.role,
    );
    return { success: true, data: assessment, error: null };
  }

  // ─── GET /api/v1/fluency/class/:classId ───────────────────────────────────

  @Get('class/:classId')
  @Roles(Role.TEACHER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get all fluency assessments for a class (teacher only)',
    description:
      'Returns all assessments ordered by created_at DESC. ' +
      'Optionally filter by ?studentId= or ?status=.',
  })
  @ApiParam({ name: 'classId', description: 'Class UUID' })
  @ApiQuery({
    name: 'studentId',
    required: false,
    description: 'Filter to a specific student',
  })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: FluencyStatus,
    description: 'Filter by assessment status',
  })
  @ApiResponse({ status: 200, description: 'List of assessments with student names' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Not a teacher of this class' })
  async getByClass(
    @Request() req: any,
    @Param('classId') classId: string,
    @Query() query: GetByClassQueryDto,
  ) {
    const assessments = await this.fluencyService.getByClass(
      classId,
      req.user.id,
      query,
    );
    return { success: true, data: assessments, error: null };
  }
}
