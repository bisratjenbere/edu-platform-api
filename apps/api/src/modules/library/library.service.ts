import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ElasticsearchService, PaginatedSearchResults } from './elasticsearch.service';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { SearchTemplatesDto, RateTemplateDto } from './dto';
import { ActivityStatus } from '@prisma/client';

@Injectable()
export class LibraryService {
  constructor(
    private prisma: PrismaService,
    private elasticsearchService: ElasticsearchService,
    @InjectQueue('library-sync') private librarySyncQueue: Queue,
  ) {}

  /**
   * Search templates with filters, sorting, and pagination
   */
  async search(dto: SearchTemplatesDto): Promise<PaginatedSearchResults> {
    const {
      q = '',
      grade,
      subject,
      standard = [],
      sortBy = 'relevance',
      page = 1,
      limit = 20,
    } = dto;

    const filters = {
      grade_level: grade,
      subject,
      standards_tags: Array.isArray(standard) ? standard : [standard],
    };

    return this.elasticsearchService.searchTemplates(
      q,
      filters,
      sortBy,
      page,
      limit,
    );
  }

  /**
   * Get a single template by ID with full details
   */
  async getById(templateId: string) {
    const template = await this.prisma.activityTemplate.findUnique({
      where: { id: templateId, deleted_at: null },
      include: {
        creator: {
          select: {
            id: true,
            first_name: true,
            last_name: true,
            email: true,
          },
        },
      },
    });

    if (!template) {
      throw new NotFoundException('Template not found');
    }

    if (!template.is_published) {
      throw new ForbiddenException('Template is not published');
    }

    // Increment view count
    await this.prisma.activityTemplate.update({
      where: { id: templateId },
      data: { view_count: { increment: 1 } },
    });

    return template;
  }

  /**
   * Copy a template into a teacher's class as a DRAFT activity
   */
  async copy(templateId: string, teacherId: string, classId: string) {
    // Verify template exists and is published
    const template = await this.prisma.activityTemplate.findUnique({
      where: { id: templateId, deleted_at: null },
    });

    if (!template) {
      throw new NotFoundException('Template not found');
    }

    if (!template.is_published) {
      throw new ForbiddenException('Template is not published');
    }

    // Verify teacher has access to the class
    const classTeacher = await this.prisma.classTeacher.findFirst({
      where: {
        class_id: classId,
        teacher_id: teacherId,
        deleted_at: null,
      },
    });

    if (!classTeacher) {
      throw new ForbiddenException('You do not have access to this class');
    }

    // Deep copy blocks_snapshot into a new Activity (DRAFT status)
    const activity = await this.prisma.activity.create({
      data: {
        title: template.title,
        description: template.description,
        class_id: classId,
        created_by: teacherId,
        status: ActivityStatus.DRAFT,
        is_from_library: true,
        library_source_id: templateId,
        standards_tags: template.standards_tags,
        subject_tag: template.subject,
        grade_level_tag: template.grade_level as any,
      },
    });

    // Copy blocks from snapshot
    const blocksSnapshot = template.blocks_snapshot as any[];
    if (Array.isArray(blocksSnapshot)) {
      await Promise.all(
        blocksSnapshot.map((block, index) =>
          this.prisma.activityBlock.create({
            data: {
              activity_id: activity.id,
              order: index,
              type: block.type,
              content: block.content,
              is_required: block.is_required ?? true,
            },
          }),
        ),
      );
    }

    // Increment copy count
    await this.prisma.activityTemplate.update({
      where: { id: templateId },
      data: { copy_count: { increment: 1 } },
    });

    return activity;
  }

  /**
   * Publish a teacher's activity as a template
   */
  async publish(activityId: string, teacherId: string) {
    // Verify teacher owns the activity
    const activity = await this.prisma.activity.findUnique({
      where: { id: activityId, deleted_at: null },
      include: {
        blocks: {
          orderBy: { order: 'asc' },
        },
      },
    });

    if (!activity) {
      throw new NotFoundException('Activity not found');
    }

    if (activity.created_by !== teacherId) {
      throw new ForbiddenException('You can only publish your own activities');
    }

    if (activity.status !== ActivityStatus.PUBLISHED) {
      throw new BadRequestException('Activity must be published first');
    }

    // Snapshot blocks
    const blocksSnapshot = activity.blocks.map((block) => ({
      type: block.type,
      content: block.content,
      is_required: block.is_required,
    }));

    // Create ActivityTemplate
    const template = await this.prisma.activityTemplate.create({
      data: {
        title: activity.title,
        description: activity.description,
        subject: activity.subject_tag,
        grade_level: activity.grade_level_tag as any,
        standards_tags: activity.standards_tags,
        created_by: teacherId,
        is_published: true,
        blocks_snapshot: blocksSnapshot,
      },
    });

    // Enqueue LibrarySyncJob to index in Elasticsearch
    await this.librarySyncQueue.add('sync-template', {
      templateId: template.id,
    });

    return template;
  }

  /**
   * Rate a template (1-5 stars + optional review)
   */
  async rate(
    templateId: string,
    userId: string,
    dto: RateTemplateDto,
  ) {
    // Verify template exists and is published
    const template = await this.prisma.activityTemplate.findUnique({
      where: { id: templateId, deleted_at: null },
    });

    if (!template) {
      throw new NotFoundException('Template not found');
    }

    if (!template.is_published) {
      throw new ForbiddenException('Template is not published');
    }

    // Upsert rating (one per user per template)
    await this.prisma.templateRating.upsert({
      where: {
        template_id_user_id: {
          template_id: templateId,
          user_id: userId,
        },
      },
      create: {
        template_id: templateId,
        user_id: userId,
        score: dto.score,
        review: dto.review,
      },
      update: {
        score: dto.score,
        review: dto.review,
      },
    });

    // Recompute avg_rating from TemplateRating table
    const aggregation = await this.prisma.templateRating.aggregate({
      where: { template_id: templateId },
      _avg: { score: true },
      _count: { score: true },
    });

    await this.prisma.activityTemplate.update({
      where: { id: templateId },
      data: {
        avg_rating: aggregation._avg.score ?? 0,
        rating_count: aggregation._count.score,
      },
    });

    return { success: true };
  }

  /**
   * Get paginated ratings for a template
   */
  async getRatings(templateId: string, page: number = 1, limit: number = 20) {
    // Verify template exists
    const template = await this.prisma.activityTemplate.findUnique({
      where: { id: templateId, deleted_at: null },
    });

    if (!template) {
      throw new NotFoundException('Template not found');
    }

    const skip = (page - 1) * limit;

    const [ratings, total] = await Promise.all([
      this.prisma.templateRating.findMany({
        where: { template_id: templateId },
        include: {
          rater: {
            select: {
              id: true,
              first_name: true,
              last_name: true,
            },
          },
        },
        orderBy: { created_at: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.templateRating.count({
        where: { template_id: templateId },
      }),
    ]);

    return {
      success: true,
      data: ratings,
      meta: {
        total,
        page,
        limit,
        hasMore: skip + ratings.length < total,
      },
    };
  }
}
