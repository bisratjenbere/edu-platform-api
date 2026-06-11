import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreatePostDto, RejectPostDto, AddCommentDto } from './dto';
import { Role, JournalPostType, JournalPostStatus, NotificationType } from '@prisma/client';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class JournalService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => NotificationsService))
    private readonly notificationsService: NotificationsService,
  ) {}

  /**
   * Get paginated journal feed for a student
   * Access control:
   * - FAMILY: only APPROVED posts for connected child
   * - TEACHER: all posts in their classes
   * - STUDENT: only APPROVED posts for self
   */
  async getFeed(
    studentId: string,
    requesterId: string,
    requesterRole: Role,
    cursor?: string,
    limit: number = 20,
  ) {
    // Validate limit
    if (limit > 50) {
      limit = 50;
    }

    // Access control check
    if (requesterRole === Role.STUDENT && requesterId !== studentId) {
      throw new ForbiddenException('Students can only view their own journal');
    }

    if (requesterRole === Role.FAMILY) {
      // Verify family is connected to this student
      const connection = await this.prisma.familyStudent.findFirst({
        where: {
          family_id: requesterId,
          student_id: studentId,
          status: 'ACTIVE',
          deleted_at: null,
        },
      });

      if (!connection) {
        throw new ForbiddenException('You do not have access to this student journal');
      }
    }

    if (requesterRole === Role.TEACHER) {
      // Verify teacher teaches this student in at least one class
      const hasAccess = await this.prisma.classStudent.findFirst({
        where: {
          student_id: studentId,
          class: {
            teachers: {
              some: {
                teacher_id: requesterId,
              },
            },
          },
        },
      });

      if (!hasAccess) {
        throw new ForbiddenException('You do not teach this student');
      }
    }

    // Build where clause based on role
    const whereClause: any = {
      student_id: studentId,
      deleted_at: null,
    };

    // FAMILY and STUDENT see only APPROVED posts
    if (requesterRole === Role.FAMILY || requesterRole === Role.STUDENT) {
      whereClause.status = JournalPostStatus.APPROVED;
    }

    // Add cursor if provided
    if (cursor) {
      whereClause.id = {
        lt: cursor,
      };
    }

    // Fetch posts
    const posts = await this.prisma.journalPost.findMany({
      where: whereClause,
      include: {
        submission: {
          include: {
            activity: {
              select: {
                id: true,
                title: true,
              },
            },
          },
        },
        reactions: {
          where: {
            user_id: requesterId,
          },
          select: {
            id: true,
            type: true,
          },
        },
        _count: {
          select: {
            reactions: true,
            comments: {
              where: {
                deleted_at: null,
              },
            },
          },
        },
      },
      orderBy: {
        created_at: 'desc',
      },
      take: limit + 1, // Fetch one extra to determine hasMore
    });

    const hasMore = posts.length > limit;
    const items = hasMore ? posts.slice(0, limit) : posts;

    return {
      items: items.map((post) => ({
        id: post.id,
        student_id: post.student_id,
        type: post.type,
        status: post.status,
        content_text: post.content_text,
        media_urls: post.media_urls,
        activity: post.submission?.activity
          ? {
              id: post.submission.activity.id,
              title: post.submission.activity.title,
            }
          : null,
        approved_by: post.approved_by,
        approved_at: post.approved_at,
        created_at: post.created_at,
        user_has_reacted: post.reactions.length > 0,
        reaction_type: post.reactions[0]?.type || null,
        reaction_count: post._count.reactions,
        comment_count: post._count.comments,
      })),
      cursor: hasMore ? items[items.length - 1].id : null,
      hasMore,
    };
  }

  /**
   * Create a student self-post (starts as PENDING_APPROVAL)
   */
  async createPost(studentId: string, classId: string, dto: CreatePostDto) {
    // Verify student belongs to this class
    const enrollment = await this.prisma.classStudent.findUnique({
      where: {
        class_id_student_id: {
          class_id: classId,
          student_id: studentId,
        },
      },
    });

    if (!enrollment || !enrollment.is_active) {
      throw new ForbiddenException('Student is not enrolled in this class');
    }

    // At least one of content_text or media_urls must be provided
    if (!dto.content_text && (!dto.media_urls || dto.media_urls.length === 0)) {
      throw new BadRequestException('Post must have content_text or media_urls');
    }

    const post = await this.prisma.journalPost.create({
      data: {
        student_id: studentId,
        class_id: classId,
        type: JournalPostType.STUDENT_SELF_POST,
        status: JournalPostStatus.PENDING_APPROVAL,
        content_text: dto.content_text || null,
        media_urls: dto.media_urls || [],
      },
    });

    return post;
  }

  /**
   * Get pending approval posts for a teacher's class
   */
  async getPending(classId: string, teacherId: string) {
    // Verify teacher teaches this class
    const teacherInClass = await this.prisma.classTeacher.findUnique({
      where: {
        class_id_teacher_id: {
          class_id: classId,
          teacher_id: teacherId,
        },
      },
    });

    if (!teacherInClass) {
      throw new ForbiddenException('You do not teach this class');
    }

    const posts = await this.prisma.journalPost.findMany({
      where: {
        class_id: classId,
        status: JournalPostStatus.PENDING_APPROVAL,
        deleted_at: null,
      },
      include: {
        submission: {
          include: {
            activity: {
              select: {
                id: true,
                title: true,
              },
            },
          },
        },
      },
      orderBy: {
        created_at: 'asc', // Oldest first for approval queue
      },
    });

    return posts.map((post) => ({
      id: post.id,
      student_id: post.student_id,
      type: post.type,
      content_text: post.content_text,
      media_urls: post.media_urls,
      activity: post.submission?.activity
        ? {
            id: post.submission.activity.id,
            title: post.submission.activity.title,
          }
        : null,
      created_at: post.created_at,
    }));
  }

  /**
   * Approve a journal post
   */
  async approve(postId: string, teacherId: string) {
    const post = await this.prisma.journalPost.findUnique({
      where: { id: postId, deleted_at: null },
    });

    if (!post) {
      throw new NotFoundException('Post not found');
    }

    // Verify teacher teaches this class
    const teacherInClass = await this.prisma.classTeacher.findUnique({
      where: {
        class_id_teacher_id: {
          class_id: post.class_id,
          teacher_id: teacherId,
        },
      },
    });

    if (!teacherInClass) {
      throw new ForbiddenException('You do not teach this class');
    }

    // Update post status
    const updatedPost = await this.prisma.journalPost.update({
      where: { id: postId },
      data: {
        status: JournalPostStatus.APPROVED,
        approved_by: teacherId,
        approved_at: new Date(),
      },
    });

    // Send JOURNAL_POST_APPROVED push notification to family members
    const familyConnections = await this.prisma.familyStudent.findMany({
      where: {
        student_id: post.student_id,
        class_id: post.class_id,
        status: 'ACTIVE',
        deleted_at: null,
      },
      select: {
        family_id: true,
      },
    });

    const familyIds = familyConnections.map((fc) => fc.family_id);
    if (familyIds.length > 0) {
      await this.notificationsService.sendBulk(familyIds, {
        type: NotificationType.JOURNAL_POST_APPROVED,
        title: 'New Journal Post',
        body: 'A new post has been added to your child\'s journal',
        data: {
          postId: updatedPost.id,
          studentId: post.student_id,
        },
      });
    }

    return updatedPost;
  }

  /**
   * Reject a journal post
   */
  async reject(postId: string, teacherId: string, dto: RejectPostDto) {
    const post = await this.prisma.journalPost.findUnique({
      where: { id: postId, deleted_at: null },
    });

    if (!post) {
      throw new NotFoundException('Post not found');
    }

    // Verify teacher teaches this class
    const teacherInClass = await this.prisma.classTeacher.findUnique({
      where: {
        class_id_teacher_id: {
          class_id: post.class_id,
          teacher_id: teacherId,
        },
      },
    });

    if (!teacherInClass) {
      throw new ForbiddenException('You do not teach this class');
    }

    // Update post status - store reason in content_text for teacher reference
    const updatedPost = await this.prisma.journalPost.update({
      where: { id: postId },
      data: {
        status: JournalPostStatus.REJECTED,
        updated_at: new Date(),
      },
    });

    return updatedPost;
  }

  /**
   * Toggle reaction (heart) on a post
   * Returns the new reaction count
   */
  async toggleReaction(postId: string, userId: string) {
    // Verify post exists
    const post = await this.prisma.journalPost.findUnique({
      where: { id: postId, deleted_at: null },
    });

    if (!post) {
      throw new NotFoundException('Post not found');
    }

    // Check if user already reacted
    const existing = await this.prisma.journalReaction.findUnique({
      where: {
        post_id_user_id: {
          post_id: postId,
          user_id: userId,
        },
      },
    });

    if (existing) {
      // Remove reaction
      await this.prisma.journalReaction.delete({
        where: {
          id: existing.id,
        },
      });
    } else {
      // Add reaction
      await this.prisma.journalReaction.create({
        data: {
          post_id: postId,
          user_id: userId,
          type: 'HEART',
        },
      });
    }

    // Get updated count
    const count = await this.prisma.journalReaction.count({
      where: {
        post_id: postId,
      },
    });

    return {
      count,
      user_has_reacted: !existing, // Toggled state
    };
  }

  /**
   * Get reactions for a post
   */
  async getReactions(postId: string, userId: string) {
    const count = await this.prisma.journalReaction.count({
      where: {
        post_id: postId,
      },
    });

    const userReaction = await this.prisma.journalReaction.findUnique({
      where: {
        post_id_user_id: {
          post_id: postId,
          user_id: userId,
        },
      },
    });

    return {
      count,
      user_has_reacted: !!userReaction,
      reaction_type: userReaction?.type || null,
    };
  }

  /**
   * Add a comment to a post
   */
  async addComment(
    postId: string,
    userId: string,
    role: Role,
    dto: AddCommentDto,
  ) {
    // Verify post exists
    const post = await this.prisma.journalPost.findUnique({
      where: { id: postId, deleted_at: null },
    });

    if (!post) {
      throw new NotFoundException('Post not found');
    }

    // Only TEACHER and FAMILY can comment
    if (role !== Role.TEACHER && role !== Role.FAMILY) {
      throw new ForbiddenException('Only teachers and family members can comment');
    }

    // Verify access
    if (role === Role.TEACHER) {
      const teacherInClass = await this.prisma.classTeacher.findUnique({
        where: {
          class_id_teacher_id: {
            class_id: post.class_id,
            teacher_id: userId,
          },
        },
      });

      if (!teacherInClass) {
        throw new ForbiddenException('You do not teach this class');
      }
    } else if (role === Role.FAMILY) {
      const connection = await this.prisma.familyStudent.findFirst({
        where: {
          family_id: userId,
          student_id: post.student_id,
          status: 'ACTIVE',
          deleted_at: null,
        },
      });

      if (!connection) {
        throw new ForbiddenException('You are not connected to this student');
      }
    }

    const comment = await this.prisma.journalComment.create({
      data: {
        post_id: postId,
        author_id: userId,
        author_role: role,
        content: dto.content,
      },
    });

    return comment;
  }

  /**
   * Get comments for a post
   */
  async getComments(postId: string, requesterId: string, requesterRole: Role) {
    // Verify post exists
    const post = await this.prisma.journalPost.findUnique({
      where: { id: postId, deleted_at: null },
    });

    if (!post) {
      throw new NotFoundException('Post not found');
    }

    // Verify access based on role
    if (requesterRole === Role.FAMILY) {
      const connection = await this.prisma.familyStudent.findFirst({
        where: {
          family_id: requesterId,
          student_id: post.student_id,
          status: 'ACTIVE',
          deleted_at: null,
        },
      });

      if (!connection) {
        throw new ForbiddenException('You are not connected to this student');
      }
    } else if (requesterRole === Role.TEACHER) {
      const teacherInClass = await this.prisma.classTeacher.findUnique({
        where: {
          class_id_teacher_id: {
            class_id: post.class_id,
            teacher_id: requesterId,
          },
        },
      });

      if (!teacherInClass) {
        throw new ForbiddenException('You do not teach this class');
      }
    } else if (requesterRole === Role.STUDENT && requesterId !== post.student_id) {
      throw new ForbiddenException('You cannot view comments on this post');
    }

    const comments = await this.prisma.journalComment.findMany({
      where: {
        post_id: postId,
        deleted_at: null,
      },
      orderBy: {
        created_at: 'asc',
      },
    });

    return comments;
  }

  /**
   * Soft delete a comment
   * Only comment author or teacher in the class can delete
   */
  async deleteComment(
    postId: string,
    commentId: string,
    requesterId: string,
    requesterRole: Role,
  ) {
    const comment = await this.prisma.journalComment.findUnique({
      where: { id: commentId, deleted_at: null },
      include: {
        post: true,
      },
    });

    if (!comment) {
      throw new NotFoundException('Comment not found');
    }

    if (comment.post_id !== postId) {
      throw new BadRequestException('Comment does not belong to this post');
    }

    // Check permissions
    const isAuthor = comment.author_id === requesterId;
    const isTeacher = requesterRole === Role.TEACHER;

    if (!isAuthor && !isTeacher) {
      throw new ForbiddenException('You cannot delete this comment');
    }

    // If teacher, verify they teach the class
    if (isTeacher && !isAuthor) {
      const teacherInClass = await this.prisma.classTeacher.findUnique({
        where: {
          class_id_teacher_id: {
            class_id: comment.post.class_id,
            teacher_id: requesterId,
          },
        },
      });

      if (!teacherInClass) {
        throw new ForbiddenException('You do not teach this class');
      }
    }

    // Soft delete
    await this.prisma.journalComment.update({
      where: { id: commentId },
      data: {
        deleted_at: new Date(),
      },
    });

    return { success: true };
  }

  /**
   * Create a journal post from an approved submission
   * Called by SubmissionsService when a submission is approved
   */
  async createPostFromSubmission(submissionId: string) {
    const submission = await this.prisma.submission.findUnique({
      where: { id: submissionId },
      include: {
        activity: {
          select: {
            title: true,
          },
        },
        blocks: true,
      },
    });

    if (!submission) {
      throw new NotFoundException('Submission not found');
    }

    // Extract media URLs from submission blocks
    const mediaUrls: string[] = [];
    for (const block of submission.blocks) {
      const content = block.response_content as any;
      
      // Extract media based on block type patterns
      if (content?.imageUrl) {
        mediaUrls.push(content.imageUrl);
      }
      if (content?.audioUrl) {
        mediaUrls.push(content.audioUrl);
      }
      if (content?.videoUrl) {
        mediaUrls.push(content.videoUrl);
      }
      if (content?.canvasDataUrl) {
        mediaUrls.push(content.canvasDataUrl);
      }
      if (Array.isArray(content?.photos)) {
        mediaUrls.push(...content.photos);
      }
    }

    const post = await this.prisma.journalPost.create({
      data: {
        student_id: submission.student_id,
        class_id: submission.class_id,
        activity_id: submission.activity_id,
        submission_id: submissionId,
        type: JournalPostType.ACTIVITY_SUBMISSION,
        status: JournalPostStatus.PENDING_APPROVAL,
        content_text: submission.activity.title,
        media_urls: mediaUrls,
      },
    });

    return post;
  }
}
