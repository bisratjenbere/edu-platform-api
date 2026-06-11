import { Injectable, Logger } from '@nestjs/common';
import { Client } from '@elastic/elasticsearch';
import { ConfigService } from '@nestjs/config';

export interface TemplateSearchFilters {
  grade_level?: string;
  subject?: string;
  standards_tags?: string[];
}

export interface TemplateSearchResult {
  id: string;
  title: string;
  description: string | null;
  subject: string | null;
  grade_level: string | null;
  standards_tags: string[];
  view_count: number;
  copy_count: number;
  avg_rating: number | null;
  rating_count: number;
  thumbnail_url: string | null;
  created_by: string;
  created_at: string;
  highlight?: {
    title?: string[];
    description?: string[];
  };
}

export interface PaginatedSearchResults {
  results: TemplateSearchResult[];
  total: number;
  page: number;
  limit: number;
}

@Injectable()
export class ElasticsearchService {
  private readonly logger = new Logger(ElasticsearchService.name);
  private readonly client: Client;
  private readonly indexName = 'activity_templates';

  constructor(private configService: ConfigService) {
    const elasticsearchUrl = this.configService.get<string>('ELASTICSEARCH_URL');
    this.client = new Client({
      node: elasticsearchUrl || 'http://localhost:9200',
    });
  }

  /**
   * Upsert a template document into Elasticsearch
   */
  async indexTemplate(template: {
    id: string;
    title: string;
    description: string | null;
    subject: string | null;
    grade_level: string | null;
    standards_tags: string[];
    view_count: number;
    copy_count: number;
    avg_rating: number | null;
    rating_count: number;
    thumbnail_url: string | null;
    created_by: string;
    is_published: boolean;
    created_at: Date;
  }): Promise<void> {
    try {
      await this.client.index({
        index: this.indexName,
        id: template.id,
        document: {
          ...template,
          created_at: template.created_at.toISOString(),
        },
      });
      this.logger.log(`Indexed template ${template.id} in Elasticsearch`);
    } catch (error: any) {
      this.logger.error(
        `Failed to index template ${template.id}: ${error?.message || 'Unknown error'}`,
        error?.stack,
      );
      // Don't throw — library search should degrade gracefully
    }
  }

  /**
   * Search templates with filters, sorting, and pagination
   */
  async searchTemplates(
    query: string,
    filters: TemplateSearchFilters,
    sortBy: 'relevance' | 'newest' | 'highest_rated' | 'most_used',
    page: number,
    limit: number,
  ): Promise<PaginatedSearchResults> {
    try {
      const from = (page - 1) * limit;

      // Build filter array
      const filterClauses: any[] = [{ term: { is_published: true } }];

      if (filters.grade_level) {
        filterClauses.push({ term: { grade_level: filters.grade_level } });
      }
      if (filters.subject) {
        filterClauses.push({ term: { subject: filters.subject } });
      }
      if (filters.standards_tags && filters.standards_tags.length > 0) {
        filterClauses.push({ terms: { standards_tags: filters.standards_tags } });
      }

      // Build sort order
      let sort: any[];
      switch (sortBy) {
        case 'newest':
          sort = [{ created_at: { order: 'desc' } }];
          break;
        case 'highest_rated':
          sort = [{ avg_rating: { order: 'desc' } }, { rating_count: { order: 'desc' } }];
          break;
        case 'most_used':
          sort = [{ copy_count: { order: 'desc' } }];
          break;
        case 'relevance':
        default:
          sort = [{ _score: { order: 'desc' } }];
          break;
      }

      // Build query
      const mustClause = query
        ? {
            multi_match: {
              query,
              fields: ['title^2', 'description'],
              type: 'best_fields',
            },
          }
        : { match_all: {} };

      const response = await this.client.search({
        index: this.indexName,
        query: {
          bool: {
            must: mustClause,
            filter: filterClauses,
          },
        },
        highlight: {
          fields: {
            title: {},
            description: {},
          },
        },
        sort,
        from,
        size: limit,
      } as any);

      const hits = response.hits.hits;
      const total = typeof response.hits.total === 'number'
        ? response.hits.total
        : response.hits.total?.value || 0;

      const results: TemplateSearchResult[] = hits.map((hit: any) => ({
        id: hit._id,
        ...(hit._source as Omit<TemplateSearchResult, 'id' | 'highlight'>),
        highlight: hit.highlight,
      }));

      return {
        results,
        total,
        page,
        limit,
      };
    } catch (error: any) {
      this.logger.error(
        `Failed to search templates: ${error?.message || 'Unknown error'}`,
        error?.stack,
      );
      // Return empty results on error — degrade gracefully
      return {
        results: [],
        total: 0,
        page,
        limit,
      };
    }
  }

  /**
   * Delete a template document from Elasticsearch
   */
  async deleteTemplate(id: string): Promise<void> {
    try {
      await this.client.delete({
        index: this.indexName,
        id,
      });
      this.logger.log(`Deleted template ${id} from Elasticsearch`);
    } catch (error: any) {
      // Ignore if document doesn't exist
      if (error?.meta?.statusCode === 404) {
        this.logger.warn(`Template ${id} not found in Elasticsearch (already deleted)`);
      } else {
        this.logger.error(
          `Failed to delete template ${id}: ${error?.message || 'Unknown error'}`,
          error?.stack,
        );
      }
      // Don't throw — delete should degrade gracefully
    }
  }
}
