import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
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
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { Role } from '@prisma/client';
import { JournalService } from './journal.service';
import { CreatePostDto, RejectPostDto, AddCommentDto } from './dto';

@ApiTags('journal')
@ApiBearerAuth()
@Controller('journal')
@UseGuards(JwtAuthGuard, RolesGuard)
export class JournalController {
  constructor(private readonly journalService: JournalService) {}

  @Get(':studentId')
  @Roles(Role.STUDENT, Role.TEACHER, Role.FAMILY)
  @ApiOperation({ summary: 'Get student journal feed (paginated)' })
  @ApiParam({ name: 'studentId', description: 'Student UUID' })
  @ApiQuery({ name: 'cursor', required: false, description: 'Pagination cursor (last post id)' })
  @ApiQuery({ name: 'limit', required: false, description: 'Items per page (max 50)', type: Number })
  @ApiResponse({ status: 200, description: 'Journal feed retrieved' })
  @ApiResponse({ status: 403, description: 'Access denied' })
  async getFeed(
    @Param('studentId') studentId: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
    @Request() req?: any,
  ) {
    const parsedLimit = limit ? parseInt(limit, 10) : 20;
    const result = await this.journalService.getFeed(
      studentId,
      req.user.id,
      req.user.role,
      cursor,
      parsedLimit,
    );

    return {
      success: true,
      data: result.items,
      error: null,
      meta: {
        cursor: result.cursor,
        hasMore: result.hasMore,
      },
    };
  }

  @Post(':studentId/posts')
  @Roles(Role.STUDENT)
  @ApiOperation({ summary: 'Create a student self-post (pending approval)' })
  @ApiParam({ name: 'studentId', description: 'Student UUID' })
  @ApiResponse({ status: 201, description: 'Post created' })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 403, description: 'Not authorized' })
  async createPost(
    @Param('studentId') studentId: string,
    @Body() dto: CreatePostDto,
    @Query('classId') classId: string,
    @Request() req?: any,
  ) {
    // Verify student is creating their own post
    if (req.user.id !== studentId) {
      return {
        success: false,
        data: null,
        error: 'Students can only create their own posts',
      };
    }

    const post = await this.journalService.createPost(studentId, classId, dto);

    return {
      success: true,
      data: post,
      error: null,
    };
  }

  @Get(':studentId/pending')
  @Roles(Role.TEACHER)
  @ApiOperation({ summary: 'Get pending approval posts for a class' })
  @ApiParam({ name: 'studentId', description: 'Student UUID (or use classId query param)' })
  @ApiQuery({ name: 'classId', required: true, description: 'Class UUID' })
  @ApiResponse({ status: 200, description: 'Pending posts retrieved' })
  @ApiResponse({ status: 403, description: 'Access denied' })
  async getPending(
    @Query('classId') classId: string,
    @Request() req?: any,
  ) {
    const posts = await this.journalService.getPending(classId, req.user.id);

    return {
      success: true,
      data: posts,
      error: null,
    };
  }

  @Post('posts/:postId/approve')
  @Roles(Role.TEACHER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Approve a journal post' })
  @ApiParam({ name: 'postId', description: 'Post UUID' })
  @ApiResponse({ status: 200, description: 'Post approved' })
  @ApiResponse({ status: 403, description: 'Access denied' })
  @ApiResponse({ status: 404, description: 'Post not found' })
  async approve(
    @Param('postId') postId: string,
    @Request() req?: any,
  ) {
    const post = await this.journalService.approve(postId, req.user.id);

    return {
      success: true,
      data: post,
      error: null,
    };
  }

  @Post('posts/:postId/reject')
  @Roles(Role.TEACHER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reject a journal post with optional reason' })
  @ApiParam({ name: 'postId', description: 'Post UUID' })
  @ApiResponse({ status: 200, description: 'Post rejected' })
  @ApiResponse({ status: 403, description: 'Access denied' })
  @ApiResponse({ status: 404, description: 'Post not found' })
  async reject(
    @Param('postId') postId: string,
    @Body() dto: RejectPostDto,
    @Request() req?: any,
  ) {
    const post = await this.journalService.reject(postId, req.user.id, dto);

    return {
      success: true,
      data: post,
      error: null,
    };
  }

  @Post('posts/:postId/reactions')
  @Roles(Role.STUDENT, Role.TEACHER, Role.FAMILY)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Toggle heart reaction on a post' })
  @ApiParam({ name: 'postId', description: 'Post UUID' })
  @ApiResponse({ status: 200, description: 'Reaction toggled' })
  @ApiResponse({ status: 404, description: 'Post not found' })
  async toggleReaction(
    @Param('postId') postId: string,
    @Request() req?: any,
  ) {
    const result = await this.journalService.toggleReaction(postId, req.user.id);

    return {
      success: true,
      data: result,
      error: null,
    };
  }

  @Get('posts/:postId/reactions')
  @Roles(Role.STUDENT, Role.TEACHER, Role.FAMILY)
  @ApiOperation({ summary: 'Get reaction count and user reaction status' })
  @ApiParam({ name: 'postId', description: 'Post UUID' })
  @ApiResponse({ status: 200, description: 'Reactions retrieved' })
  async getReactions(
    @Param('postId') postId: string,
    @Request() req?: any,
  ) {
    const result = await this.journalService.getReactions(postId, req.user.id);

    return {
      success: true,
      data: result,
      error: null,
    };
  }

  @Post('posts/:postId/comments')
  @Roles(Role.TEACHER, Role.FAMILY)
  @ApiOperation({ summary: 'Add a comment to a post' })
  @ApiParam({ name: 'postId', description: 'Post UUID' })
  @ApiResponse({ status: 201, description: 'Comment created' })
  @ApiResponse({ status: 403, description: 'Access denied - only teachers and family can comment' })
  @ApiResponse({ status: 404, description: 'Post not found' })
  async addComment(
    @Param('postId') postId: string,
    @Body() dto: AddCommentDto,
    @Request() req?: any,
  ) {
    const comment = await this.journalService.addComment(
      postId,
      req.user.id,
      req.user.role,
      dto,
    );

    return {
      success: true,
      data: comment,
      error: null,
    };
  }

  @Get('posts/:postId/comments')
  @Roles(Role.STUDENT, Role.TEACHER, Role.FAMILY)
  @ApiOperation({ summary: 'Get comments for a post' })
  @ApiParam({ name: 'postId', description: 'Post UUID' })
  @ApiResponse({ status: 200, description: 'Comments retrieved' })
  @ApiResponse({ status: 403, description: 'Access denied' })
  async getComments(
    @Param('postId') postId: string,
    @Request() req?: any,
  ) {
    const comments = await this.journalService.getComments(
      postId,
      req.user.id,
      req.user.role,
    );

    return {
      success: true,
      data: comments,
      error: null,
    };
  }

  @Delete('posts/:postId/comments/:commentId')
  @Roles(Role.TEACHER, Role.FAMILY)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Soft delete a comment (author or teacher only)' })
  @ApiParam({ name: 'postId', description: 'Post UUID' })
  @ApiParam({ name: 'commentId', description: 'Comment UUID' })
  @ApiResponse({ status: 200, description: 'Comment deleted' })
  @ApiResponse({ status: 403, description: 'Access denied' })
  @ApiResponse({ status: 404, description: 'Comment not found' })
  async deleteComment(
    @Param('postId') postId: string,
    @Param('commentId') commentId: string,
    @Request() req?: any,
  ) {
    const result = await this.journalService.deleteComment(
      postId,
      commentId,
      req.user.id,
      req.user.role,
    );

    return {
      success: true,
      data: result,
      error: null,
    };
  }
}
