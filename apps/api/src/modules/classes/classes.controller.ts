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
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiConsumes, ApiQuery } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { Role } from '@prisma/client';
import { ClassesService } from './classes.service';
import { ClassCodeService } from './class-code.service';
import { FamilyInviteService } from './family-invite.service';
import { RosterImportService } from './roster-import.service';
import {
  CreateClassDto,
  UpdateClassDto,
  AddCoTeacherDto,
  AddStudentDto,
  CreateFamilyInviteDto,
  JoinClassDto,
} from './dto';

interface RequestWithUser {
  user: {
    id: string;
    email: string;
    role: Role;
    schoolId: string;
  };
}

@ApiTags('classes')
@Controller('classes')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class ClassesController {
  constructor(
    private classesService: ClassesService,
    private classCodeService: ClassCodeService,
    private familyInviteService: FamilyInviteService,
    private rosterImportService: RosterImportService,
  ) {}

  @Post()
  @Roles(Role.TEACHER)
  @ApiOperation({ summary: 'Create a new class' })
  @ApiResponse({ status: 201, description: 'Class created successfully' })
  @ApiResponse({ status: 409, description: 'Class name already exists for this school year' })
  async create(@Request() req: RequestWithUser, @Body() dto: CreateClassDto) {
    return this.classesService.create(req.user.id, req.user.schoolId, dto);
  }

  @Get()
  @Roles(Role.TEACHER, Role.SCHOOL_ADMIN)
  @ApiOperation({ summary: 'List all classes for the teacher' })
  @ApiQuery({ name: 'includeArchived', required: false, type: Boolean })
  @ApiResponse({ status: 200, description: 'Classes retrieved successfully' })
  async findAll(@Request() req: RequestWithUser, @Query('includeArchived') includeArchived?: string) {
    const include = includeArchived === 'true';
    return this.classesService.findAll(req.user.id, include);
  }

  @Get(':id')
  @Roles(Role.TEACHER, Role.SCHOOL_ADMIN)
  @ApiOperation({ summary: 'Get class details by ID' })
  @ApiResponse({ status: 200, description: 'Class retrieved successfully' })
  @ApiResponse({ status: 404, description: 'Class not found' })
  async findOne(@Request() req: RequestWithUser, @Param('id') id: string) {
    return this.classesService.findOne(id, req.user.id);
  }

  @Patch(':id')
  @Roles(Role.TEACHER)
  @ApiOperation({ summary: 'Update class details' })
  @ApiResponse({ status: 200, description: 'Class updated successfully' })
  @ApiResponse({ status: 404, description: 'Class not found' })
  async update(@Request() req: RequestWithUser, @Param('id') id: string, @Body() dto: UpdateClassDto) {
    return this.classesService.update(id, req.user.id, dto);
  }

  @Post(':id/archive')
  @Roles(Role.TEACHER)
  @ApiOperation({ summary: 'Archive a class' })
  @ApiResponse({ status: 200, description: 'Class archived successfully' })
  @ApiResponse({ status: 403, description: 'Only primary teacher can archive' })
  async archive(@Request() req: RequestWithUser, @Param('id') id: string) {
    return this.classesService.archive(id, req.user.id);
  }

  @Delete(':id')
  @Roles(Role.TEACHER)
  @ApiOperation({ summary: 'Delete a class (soft delete)' })
  @ApiResponse({ status: 200, description: 'Class deleted successfully' })
  @ApiResponse({ status: 403, description: 'Only primary teacher can delete' })
  async remove(@Request() req: RequestWithUser, @Param('id') id: string) {
    return this.classesService.softDelete(id, req.user.id);
  }

  @Post(':id/teachers')
  @Roles(Role.TEACHER)
  @ApiOperation({ summary: 'Add a co-teacher to the class' })
  @ApiResponse({ status: 201, description: 'Co-teacher added successfully' })
  @ApiResponse({ status: 404, description: 'Teacher not found in school' })
  @ApiResponse({ status: 409, description: 'Teacher already a co-teacher' })
  async addCoTeacher(@Request() req: RequestWithUser, @Param('id') id: string, @Body() dto: AddCoTeacherDto) {
    return this.classesService.addCoTeacher(id, req.user.id, dto);
  }

  @Delete(':id/teachers/:teacherId')
  @Roles(Role.TEACHER)
  @ApiOperation({ summary: 'Remove a co-teacher from the class' })
  @ApiResponse({ status: 200, description: 'Co-teacher removed successfully' })
  @ApiResponse({ status: 400, description: 'Cannot remove primary teacher' })
  async removeCoTeacher(
    @Request() req: RequestWithUser,
    @Param('id') id: string,
    @Param('teacherId') teacherId: string,
  ) {
    return this.classesService.removeCoTeacher(id, req.user.id, teacherId);
  }

  @Post(':id/students')
  @Roles(Role.TEACHER)
  @ApiOperation({ summary: 'Add a student to the class' })
  @ApiResponse({ status: 201, description: 'Student added successfully' })
  @ApiResponse({ status: 404, description: 'Student not found' })
  async addStudent(@Request() req: RequestWithUser, @Param('id') id: string, @Body() dto: AddStudentDto) {
    return this.classesService.addStudent(id, req.user.id, dto);
  }

  @Delete(':id/students/:studentId')
  @Roles(Role.TEACHER)
  @ApiOperation({ summary: 'Remove a student from the class' })
  @ApiResponse({ status: 200, description: 'Student removed successfully' })
  async removeStudent(
    @Request() req: RequestWithUser,
    @Param('id') id: string,
    @Param('studentId') studentId: string,
  ) {
    return this.classesService.removeStudent(id, req.user.id, studentId);
  }

  @Post(':id/students/import')
  @Roles(Role.TEACHER)
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Import students from CSV file' })
  @ApiResponse({ status: 200, description: 'Students imported successfully' })
  @ApiResponse({ status: 400, description: 'Invalid CSV format or file too large' })
  async importRoster(
    @Request() req: RequestWithUser,
    @Param('id') id: string,
    @UploadedFile() file: any,
  ) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    if (file.mimetype !== 'text/csv' && !file.originalname.endsWith('.csv')) {
      throw new BadRequestException('File must be a CSV');
    }

    const result = await this.rosterImportService.import(
      id,
      req.user.id,
      req.user.schoolId,
      file.buffer,
    );

    return {
      success: true,
      data: result,
      error: null,
    };
  }

  @Post(':id/family-invites')
  @Roles(Role.TEACHER)
  @ApiOperation({ summary: 'Invite a family member to connect to a student' })
  @ApiResponse({ status: 201, description: 'Family invite sent successfully' })
  @ApiResponse({ status: 404, description: 'Student not found in class' })
  async inviteFamily(
    @Request() req: RequestWithUser,
    @Param('id') id: string,
    @Body() dto: CreateFamilyInviteDto,
  ) {
    return this.familyInviteService.invite(id, req.user.id, dto.email, dto.student_id);
  }

  @Get('family-invites/accept')
  @ApiOperation({ summary: 'Accept a family invite (public endpoint via JWT in query)' })
  @ApiResponse({ status: 200, description: 'Invite accepted successfully' })
  @ApiResponse({ status: 401, description: 'Invalid or expired token' })
  async acceptFamilyInvite(@Query('token') token: string) {
    if (!token) {
      throw new BadRequestException('Token is required');
    }
    return this.familyInviteService.acceptInvite(token);
  }

  @Delete(':id/family/:familyStudentId')
  @Roles(Role.TEACHER)
  @ApiOperation({ summary: 'Revoke a family connection' })
  @ApiResponse({ status: 200, description: 'Family connection revoked successfully' })
  async revokeFamily(
    @Request() req: RequestWithUser,
    @Param('id') id: string,
    @Param('familyStudentId') familyStudentId: string,
  ) {
    return this.familyInviteService.revokeInvite(id, req.user.id, familyStudentId);
  }

  @Post(':id/class-code')
  @Roles(Role.TEACHER)
  @ApiOperation({ summary: 'Generate a class code for student enrollment' })
  @ApiResponse({ status: 201, description: 'Class code generated successfully' })
  async generateClassCode(@Request() req: RequestWithUser, @Param('id') id: string) {
    return this.classCodeService.generate(id, req.user.id);
  }

  @Post('join')
  @Roles(Role.STUDENT)
  @ApiOperation({ summary: 'Join a class using a class code' })
  @ApiResponse({ status: 200, description: 'Successfully joined class' })
  @ApiResponse({ status: 400, description: 'Invalid or expired code' })
  async joinClass(@Request() req: RequestWithUser, @Body() dto: JoinClassDto) {
    return this.classCodeService.join(req.user.id, dto.code);
  }
}
