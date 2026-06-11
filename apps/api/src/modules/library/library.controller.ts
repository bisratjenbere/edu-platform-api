import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
  ParseIntPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { Role } from '@prisma/client';
import { LibraryService } from './library.service';
import {
  SearchTemplatesDto,
  RateTemplateDto,
  PublishTemplateDto,
  CopyTemplateDto,
} from './dto';

@ApiTags('library')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('library')
export class LibraryController {
  constructor(private libraryService: LibraryService) {}

  @Get('templates')
  @Roles(Role.TEACHER, Role.SCHOOL_ADMIN, Role.DISTRICT_ADMIN)
  @ApiOperation({ summary: 'Search activity templates in library' })
  @ApiResponse({ status: 200, description: 'Paginated search results returned' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async searchTemplates(@Query() dto: SearchTemplatesDto) {
    const results = await this.libraryService.search(dto);
    return {
      success: true,
      data: results.results,
      meta: {
        total: results.total,
        page: results.page,
        limit: results.limit,
        hasMore: (results.page - 1) * results.limit + results.results.length < results.total,
      },
    };
  }

  @Get('templates/:id')
  @Roles(Role.TEACHER, Role.SCHOOL_ADMIN, Role.DISTRICT_ADMIN)
  @ApiOperation({ summary: 'Get template by ID with full details' })
  @ApiParam({ name: 'id', description: 'Template UUID' })
  @ApiResponse({ status: 200, description: 'Template details returned' })
  @ApiResponse({ status: 404, description: 'Template not found' })
  @ApiResponse({ status: 403, description: 'Template is not published' })
  async getTemplate(@Param('id') id: string) {
    const template = await this.libraryService.getById(id);
    return {
      success: true,
      data: template,
      error: null,
    };
  }

  @Post('templates/:id/copy')
  @Roles(Role.TEACHER)
  @ApiOperation({ summary: 'Copy template into teacher class as DRAFT activity' })
  @ApiParam({ name: 'id', description: 'Template UUID' })
  @ApiResponse({ status: 201, description: 'Activity created from template' })
  @ApiResponse({ status: 404, description: 'Template not found' })
  @ApiResponse({ status: 403, description: 'Access denied to class or template not published' })
  async copyTemplate(
    @Param('id') id: string,
    @Body() dto: CopyTemplateDto,
    @Req() req: any,
  ) {
    const activity = await this.libraryService.copy(
      id,
      req.user.id,
      dto.classId,
    );
    return {
      success: true,
      data: activity,
      error: null,
    };
  }

  @Post('templates')
  @Roles(Role.TEACHER)
  @ApiOperation({ summary: 'Publish own activity as template' })
  @ApiResponse({ status: 201, description: 'Template published successfully' })
  @ApiResponse({ status: 404, description: 'Activity not found' })
  @ApiResponse({ status: 403, description: 'Can only publish own activities' })
  @ApiResponse({ status: 400, description: 'Activity must be published first' })
  async publishTemplate(@Body() dto: PublishTemplateDto, @Req() req: any) {
    const template = await this.libraryService.publish(
      dto.activityId,
      req.user.id,
    );
    return {
      success: true,
      data: template,
      error: null,
    };
  }

  @Post('templates/:id/rate')
  @Roles(Role.TEACHER)
  @ApiOperation({ summary: 'Rate a template (1-5 stars + optional review)' })
  @ApiParam({ name: 'id', description: 'Template UUID' })
  @ApiResponse({ status: 200, description: 'Rating saved successfully' })
  @ApiResponse({ status: 404, description: 'Template not found' })
  @ApiResponse({ status: 403, description: 'Template is not published' })
  async rateTemplate(
    @Param('id') id: string,
    @Body() dto: RateTemplateDto,
    @Req() req: any,
  ) {
    const result = await this.libraryService.rate(id, req.user.id, dto);
    return {
      success: true,
      data: result,
      error: null,
    };
  }

  @Get('templates/:id/ratings')
  @Roles(Role.TEACHER, Role.SCHOOL_ADMIN, Role.DISTRICT_ADMIN)
  @ApiOperation({ summary: 'Get paginated ratings for a template' })
  @ApiParam({ name: 'id', description: 'Template UUID' })
  @ApiQuery({ name: 'page', required: false, type: Number, description: 'Page number' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Results per page' })
  @ApiResponse({ status: 200, description: 'Paginated ratings returned' })
  @ApiResponse({ status: 404, description: 'Template not found' })
  async getRatings(
    @Param('id') id: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ) {
    return this.libraryService.getRatings(id, page, limit);
  }
}
