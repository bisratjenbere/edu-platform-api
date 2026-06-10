# Library Module — Design

## API endpoints

```
GET    /api/v1/library/templates?q=&grade=&subject=&standard=&sortBy=&page=&limit=
GET    /api/v1/library/templates/:id
POST   /api/v1/library/templates/:id/copy     — copy into teacher's class as DRAFT Activity
POST   /api/v1/library/templates              — teacher publishes own activity as template
POST   /api/v1/library/templates/:id/rate     — 1–5 stars + optional review
GET    /api/v1/library/templates/:id/ratings  — paginated ratings list
```

## File structure

```
src/modules/library/
  dto/
    search-templates.dto.ts
    rate-template.dto.ts
    publish-template.dto.ts
  library.module.ts
  library.controller.ts
  library.service.ts
  library.service.spec.ts
  elasticsearch.service.ts
  library-sync.job.ts
  index.ts

apps/web/components/library/
  LibrarySearchPage.tsx
  TemplateCard.tsx
  TemplateDetailModal.tsx
```

## Elasticsearch query design

Index: `activity_templates`

```json
{
  "query": {
    "bool": {
      "must": {
        "multi_match": {
          "query": "<q>",
          "fields": ["title^2", "description"],
          "type": "best_fields"
        }
      },
      "filter": [
        { "term": { "grade_level": "<grade>" } },
        { "term": { "subject": "<subject>" } },
        { "terms": { "standards_tags": ["<standard>"] } },
        { "term": { "is_published": true } }
      ]
    }
  },
  "highlight": { "fields": { "title": {}, "description": {} } },
  "sort": "<relevance|newest|highest_rated|most_used>"
}
```

## Pagination

Library uses offset-based pagination (admin-table pattern, see api-standards.md):
- `page` (default 1) + `limit` (default 20, max 50)
- Returns `meta.total` for pagination controls

## Rating avg recomputation

On every rate() call:
```typescript
const avg = await prisma.templateRating.aggregate({
  where: { template_id: templateId },
  _avg: { score: true },
  _count: { score: true },
});
await prisma.activityTemplate.update({
  where: { id: templateId },
  data: { avg_rating: avg._avg.score, rating_count: avg._count.score },
});
```

Never update avg_rating directly — always recompute from TemplateRating table.

## Key dependencies

- `@elastic/elasticsearch` — Elasticsearch client
- `@nestjs/bull` + BullMQ — library sync queue
