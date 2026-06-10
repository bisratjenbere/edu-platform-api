# Content Library Module — Full Spec

## Requirements
100,000+ community activity templates, searchable by grade, subject, and standards.
Powered by Elasticsearch for fast full-text search with filters.

## API endpoints
```
GET    /api/v1/library/templates?q=&grade=&subject=&standard=&sortBy=&page=&limit=
GET    /api/v1/library/templates/:id
POST   /api/v1/library/templates/:id/copy     — copy into teacher's class as Activity
POST   /api/v1/library/templates              — teacher publishes own activity as template
POST   /api/v1/library/templates/:id/rate     — 1–5 stars + optional review
GET    /api/v1/library/templates/:id/ratings
```

## Elasticsearch query design
- Multi-match on title (boost: 2) + description
- Filter context: grade_level, subject, standards_tags (keyword filters, zero score impact)
- Sort: relevance | newest | highest_rated | most_used
- Highlight snippets on title and description fields

## Sync strategy
- On template publish: enqueue LibrarySyncJob (BullMQ queue: `library-sync`)
- LibrarySyncJob upserts document in Elasticsearch via @elastic/elasticsearch client

## Tasks
- [ ] Task 1: ElasticsearchService wrapper (index, search, delete, upsert)
- [ ] Task 2: LibraryService — search, getById, copy, publish, rate
- [ ] Task 3: LibrarySyncJob — BullMQ processor
- [ ] Task 4: LibraryController — all endpoints
- [ ] Task 5: Frontend — LibrarySearchPage (search bar, filter chips, results grid)
- [ ] Task 6: Frontend — TemplateCard + TemplateDetailModal (preview blocks, add to class)
- [ ] Task 7: Unit tests
