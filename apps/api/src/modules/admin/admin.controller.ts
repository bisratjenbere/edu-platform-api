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
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  ParseIntPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
  ApiConsumes,
  ApiBody,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { Role } from '@prisma/client';
import { AdminService } from './admin.service';
import { BulkImportService } from './bulk-import.service';
import {
  CreateTeacherDto,
  ResetPasswordResponseDto,
  BulkImportResultDto,
} from './dto';

@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('admin')
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly bulkImportService: BulkImportService,
  ) {}

  @Get('dashboard')
  @Roles(Role.SCHOOL_ADMIN, Role.DISTRICT_ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Get admin dashboard stats' })
  @ApiResponse({
    status: 200,
    description: 'Dashboard stats retrieved',
    schema: {
      example: {
        success: true,
        data: {
          activeTeachers: 15,
          submissionsToday: 42,
          submissionRatePerClass: [
            { classId: '...', className: '3rd Grade Math', submissionRate: 85 },
          ],
        },
        error: null,
      },
    },
  })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async getDashboard(@Request() req: any) {
    const schoolId = req.user.schoolId;
    const data = await this.adminService.getDashboard(schoolId);
    return { success: true, data, error: null };
  }

  @Get('teachers')
  @Roles(Role.SCHOOL_ADMIN, Role.DISTRICT_ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Get paginated list of teachers' })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20 })
  @ApiResponse({
    status: 200,
    description: 'Teachers retrieved',
    schema: {
      example: {
        success: true,
        data: {
          data: [
            {
              id: '...',
              email: 'teacher@school.edu',
              firstName: 'Jane',
              lastName: 'Smith',
              isActive: true,
              lastLoginAt: '2024-01-15T10:30:00Z',
              classCount: 3,
            },
          ],
          meta: { page: 1, limit: 20, total: 45, hasMore: true },
        },
        error: null,
      },
    },
  })
  async getTeachers(
    @Request() req: any,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ) {
    const schoolId = req.user.schoolId;
    const data = await this.adminService.getTeachers(schoolId, page, limit);
    return { success: true, data, error: null };
  }

  @Post('teachers')
  @Roles(Role.SCHOOL_ADMIN, Role.DISTRICT_ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Create new teacher account' })
  @ApiResponse({
    status: 201,
    description: 'Teacher created and welcome email sent',
  })
  @ApiResponse({ status: 400, description: 'Email already exists' })
  @ApiResponse({ status: 404, description: 'School not found' })
  async createTeacher(@Request() req: any, @Body() dto: CreateTeacherDto) {
    const adminId = req.user.id;
    const data = await this.adminService.createTeacher(dto, adminId);
    return { success: true, data, error: null };
  }

  @Patch('teachers/:id/deactivate')
  @Roles(Role.SCHOOL_ADMIN, Role.DISTRICT_ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Deactivate teacher account' })
  @ApiResponse({ status: 200, description: 'Teacher deactivated' })
  @ApiResponse({ status: 404, description: 'Teacher not found' })
  async deactivateTeacher(@Request() req: any, @Param('id') teacherId: string) {
    const adminId = req.user.id;
    const schoolId = req.user.schoolId;
    await this.adminService.deactivateTeacher(teacherId, adminId, schoolId);
    return {
      success: true,
      data: { message: 'Teacher deactivated successfully' },
      error: null,
    };
  }

  @Post('teachers/:id/reset-password')
  @Roles(Role.SCHOOL_ADMIN, Role.DISTRICT_ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Reset teacher password and send email' })
  @ApiResponse({
    status: 200,
    description: 'Password reset',
    type: ResetPasswordResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Teacher not found' })
  async resetPassword(@Request() req: any, @Param('id') teacherId: string) {
    const adminId = req.user.id;
    const schoolId = req.user.schoolId;
    const data = await this.adminService.resetPassword(
      teacherId,
      adminId,
      schoolId,
    );
    return { success: true, data, error: null };
  }

  @Get('classes')
  @Roles(Role.SCHOOL_ADMIN, Role.DISTRICT_ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Get paginated list of classes' })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20 })
  @ApiResponse({
    status: 200,
    description: 'Classes retrieved',
  })
  async getClasses(
    @Request() req: any,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ) {
    const schoolId = req.user.schoolId;
    const data = await this.adminService.getClasses(schoolId, page, limit);
    return { success: true, data, error: null };
  }

  @Get('students')
  @Roles(Role.SCHOOL_ADMIN, Role.DISTRICT_ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Get paginated searchable list of students' })
  @ApiQuery({
    name: 'q',
    required: false,
    type: String,
    description: 'Search by name or email',
  })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20 })
  @ApiResponse({
    status: 200,
    description: 'Students retrieved',
  })
  async getStudents(
    @Request() req: any,
    @Query('q') search: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ) {
    const schoolId = req.user.schoolId;
    const data = await this.adminService.getStudents(
      schoolId,
      search,
      page,
      limit,
    );
    return { success: true, data, error: null };
  }

  @Post('rosters/bulk-import')
  @Roles(Role.SCHOOL_ADMIN, Role.DISTRICT_ADMIN, Role.SUPER_ADMIN)
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({ summary: 'Bulk import users from CSV file' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description: 'CSV file with columns: email, first_name, last_name, role',
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Import completed',
    type: BulkImportResultDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid CSV format or exceeds 1000 rows',
  })
  async bulkImport(
    @Request() req: any,
    @UploadedFile() file: any,
  ) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    if (file.mimetype !== 'text/csv' && !file.originalname.endsWith('.csv')) {
      throw new BadRequestException('File must be CSV format');
    }

    const schoolId = req.user.schoolId;
    const adminId = req.user.id;

    const data = await this.bulkImportService.import(
      schoolId,
      adminId,
      file.buffer,
    );
    return { success: true, data, error: null };
  }

  @Post('export/student/:studentId')
  @Roles(Role.SCHOOL_ADMIN, Role.DISTRICT_ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Export student portfolio as JSON' })
  @ApiResponse({
    status: 200,
    description: 'Portfolio exported',
    schema: {
      example: {
        success: true,
        data: {
          student: {
            id: '...',
            email: 'student@school.edu',
            firstName: 'John',
            lastName: 'Doe',
          },
          journalPosts: [],
          submissions: [],
          exportedAt: '2024-01-15T10:30:00Z',
        },
        error: null,
      },
    },
  })
  @ApiResponse({ status: 404, description: 'Student not found' })
  async exportStudentPortfolio(
    @Request() req: any,
    @Param('studentId') studentId: string,
  ) {
    const adminId = req.user.id;
    const schoolId = req.user.schoolId;
    const data = await this.adminService.exportStudentPortfolio(
      studentId,
      adminId,
      schoolId,
    );
    return { success: true, data, error: null };
  }
}
