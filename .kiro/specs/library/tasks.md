# Library Module — Tasks

## Implementation order (follow this sequence exactly)

- [ ] Task 1: ElasticsearchService wrapper — `src/modules/library/elasticsearch.service.ts`
  - `indexTemplate(template)` — upsert document in `activity_templates` index
  - `searchTemplates(query, filters, sort, page, limit)` — multi-match query with filter context
  - `deleteTemplate(id)` — delete document by id
  - Wrap all calls in try/catch — ES errors must not crash requests
  - Mock in tests — never hit real Elasticsearch in unit tests

- [ ] Task 2: LibraryService
  - `search(dto)` — call ElasticsearchService.searchTemplates, return offset-paginated results with highlight snippets
  - `getById(templateId)` — find ActivityTemplate in Postgres (not ES), include blocks_snapshot
  - `copy(templateId, teacherId, classId)` — deep copy blocks_snapshot into a new Activity (DRAFT status), increment ActivityTemplate.copy_count
  - `publish(activityId, teacherId)` — verify teacher owns activity, snapshot blocks, create ActivityTemplate, set is_published = true, enqueue LibrarySyncJob
  - `rate(templateId, userId, score, review?)` — upsert TemplateRating (one per user per template), recompute avg on ActivityTemplate via Prisma aggregation

- [ ] Task 3: LibrarySyncJob — BullMQ queue: `library-sync`
  - On execute: fetch ActivityTemplate from Postgres by id, call ElasticsearchService.indexTemplate
  - On failure: log to Sentry, do not throw (library search degrades gracefully)

- [ ] Task 4: LibraryController — all endpoints
  - `GET /api/v1/library/templates` — `@Roles(Role.TEACHER)` (public read, teacher only)
  - `GET /api/v1/library/templates/:id` — `@Roles(Role.TEACHER)`
  - `POST /api/v1/library/templates/:id/copy` — `@Roles(Role.TEACHER)`
  - `POST /api/v1/library/templates` — `@Roles(Role.TEACHER)`
  - `POST /api/v1/library/templates/:id/rate` — `@Roles(Role.TEACHER)`
  - `GET /api/v1/library/templates/:id/ratings` — `@Roles(Role.TEACHER)`
  - Full OpenAPI decorators

- [ ] Task 5: Frontend — LibrarySearchPage
  - Search bar (debounced 300ms, triggers query on change)
  - Filter chips: grade level, subject, standards tag
  - Sort dropdown: Relevance | Newest | Highest Rated | Most Used
  - Results grid (TemplateCard components)
  - Offset pagination controls
  - Empty state with illustration

- [ ] Task 6: Frontend — TemplateCard + TemplateDetailModal
  - TemplateCard: thumbnail, title, grade badge, subject badge, star rating, copy count
  - TemplateDetailModal: block preview list (read-only), add to class button (class selector)
  - Star rating component (half-star precision display, whole-star input)

- [ ] Task 7: Unit tests
  - `library.service.spec.ts` — search (mocked ES), getById, copy (correct DRAFT created), publish (snapshot + job enqueued), rate (upsert + avg recomputed)
