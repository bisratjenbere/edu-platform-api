import { Processor, Process } from '@nestjs/bull';
import { Job } from 'bull';
import { Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ElasticsearchService } from './elasticsearch.service';

@Processor('library-sync')
export class LibrarySyncProcessor {
  private readonly logger = new Logger(LibrarySyncProcessor.name);

  constructor(
    private prisma: PrismaService,
    private elasticsearchService: ElasticsearchService,
  ) {}

  @Process('sync-template')
  async handleSync(job: Job<{ templateId: string }>) {
    const { templateId } = job.data;

    try {
      // Fetch ActivityTemplate from Postgres
      const template = await this.prisma.activityTemplate.findUnique({
        where: { id: templateId, deleted_at: null },
      });

      if (!template) {
        this.logger.warn(`Template ${templateId} not found or deleted — skipping sync`);
        return;
      }

      if (!template.is_published) {
        // If unpublished, delete from Elasticsearch
        await this.elasticsearchService.deleteTemplate(templateId);
        this.logger.log(`Removed unpublished template ${templateId} from Elasticsearch`);
        return;
      }

      // Index in Elasticsearch
      await this.elasticsearchService.indexTemplate({
        id: template.id,
        title: template.title,
        description: template.description,
        subject: template.subject,
        grade_level: template.grade_level,
        standards_tags: template.standards_tags,
        view_count: template.view_count,
        copy_count: template.copy_count,
        avg_rating: template.avg_rating,
        rating_count: template.rating_count,
        thumbnail_url: template.thumbnail_url,
        created_by: template.created_by,
        is_published: template.is_published,
        created_at: template.created_at,
      });

      this.logger.log(`Successfully synced template ${templateId} to Elasticsearch`);
    } catch (error: any) {
      this.logger.error(
        `Failed to sync template ${templateId}: ${error?.message || 'Unknown error'}`,
        error?.stack,
      );
      // Log error but don't throw — library search degrades gracefully
      // TODO: Add Sentry.captureException when Sentry is integrated
    }
  }
}
