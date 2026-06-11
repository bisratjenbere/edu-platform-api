import {
  Controller,
  Post,
  Get,
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
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { Role } from '@prisma/client';
import { MessagesService } from './messages.service';
import { CreateThreadDto, SendMessageDto } from './dto';

interface AuthenticatedRequest {
  user: { id: string; role: Role };
}

@ApiTags('messages')
@ApiBearerAuth()
@Controller('messages')
@UseGuards(JwtAuthGuard, RolesGuard)
export class MessagesController {
  constructor(private readonly messagesService: MessagesService) {}

  @Post('threads')
  @Roles(Role.TEACHER)
  @ApiOperation({ summary: 'Create a new message thread' })
  @ApiResponse({
    status: 201,
    description: 'Thread created successfully',
  })
  @ApiResponse({ status: 403, description: 'Only teachers can create threads' })
  async createThread(
    @Request() req: AuthenticatedRequest,
    @Body() dto: CreateThreadDto,
  ) {
    const thread = await this.messagesService.createThread(req.user.id, dto);
    return {
      success: true,
      data: thread,
      error: null,
    };
  }

  @Get('threads')
  @Roles(Role.TEACHER, Role.FAMILY)
  @ApiOperation({ summary: 'Get all threads for current user' })
  @ApiQuery({
    name: 'cursor',
    required: false,
    description: 'Cursor for pagination',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Number of threads to return',
    type: Number,
  })
  @ApiResponse({
    status: 200,
    description: 'Returns paginated threads',
  })
  async getThreads(
    @Request() req: AuthenticatedRequest,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    const result = await this.messagesService.getThreads(
      req.user.id,
      cursor,
      limit ? parseInt(limit, 10) : undefined,
    );
    return {
      success: true,
      data: result.threads,
      error: null,
      meta: {
        cursor: result.nextCursor,
        hasMore: result.hasMore,
      },
    };
  }

  @Get('threads/:id')
  @Roles(Role.TEACHER, Role.FAMILY)
  @ApiOperation({ summary: 'Get thread with messages' })
  @ApiQuery({
    name: 'cursor',
    required: false,
    description: 'Cursor for pagination',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Number of messages to return',
    type: Number,
  })
  @ApiResponse({
    status: 200,
    description: 'Returns thread and paginated messages',
  })
  @ApiResponse({ status: 403, description: 'Not a participant in this thread' })
  async getThread(
    @Request() req: AuthenticatedRequest,
    @Param('id') threadId: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    const result = await this.messagesService.getThread(
      threadId,
      req.user.id,
      cursor,
      limit ? parseInt(limit, 10) : undefined,
    );
    return {
      success: true,
      data: {
        thread: result.thread,
        messages: result.messages,
      },
      error: null,
      meta: {
        cursor: result.nextCursor,
        hasMore: result.hasMore,
      },
    };
  }

  @Post('threads/:id/messages')
  @Roles(Role.TEACHER, Role.FAMILY)
  @ApiOperation({ summary: 'Send a message in a thread' })
  @ApiResponse({
    status: 201,
    description: 'Message sent successfully',
  })
  @ApiResponse({ status: 403, description: 'Not a participant or replies disabled' })
  async sendMessage(
    @Request() req: AuthenticatedRequest,
    @Param('id') threadId: string,
    @Body() dto: SendMessageDto,
  ) {
    const message = await this.messagesService.sendMessage(
      threadId,
      req.user.id,
      dto,
    );
    return {
      success: true,
      data: message,
      error: null,
    };
  }

  @Patch('threads/:id/read')
  @Roles(Role.TEACHER, Role.FAMILY)
  @ApiOperation({ summary: 'Mark thread as read' })
  @ApiResponse({
    status: 200,
    description: 'Thread marked as read',
  })
  @ApiResponse({ status: 403, description: 'Not a participant in this thread' })
  async markRead(
    @Request() req: AuthenticatedRequest,
    @Param('id') threadId: string,
  ) {
    await this.messagesService.markRead(threadId, req.user.id);
    return {
      success: true,
      data: { message: 'Thread marked as read' },
      error: null,
    };
  }

  @Get('unread-count')
  @Roles(Role.TEACHER, Role.FAMILY)
  @ApiOperation({ summary: 'Get total unread message count' })
  @ApiResponse({
    status: 200,
    description: 'Returns unread message count',
  })
  async getUnreadCount(@Request() req: AuthenticatedRequest) {
    const count = await this.messagesService.getUnreadCount(req.user.id);
    return {
      success: true,
      data: { unreadCount: count },
      error: null,
    };
  }
}
