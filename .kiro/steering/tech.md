---
inclusion: always
---

# EduFlow — Technology Stack

## Non-negotiable stack (never suggest alternatives)

### Backend

| Layer | Choice | Version |
|---|---|---|
| Runtime | Node.js | 20 LTS |
| Framework | NestJS | 10.x |
| Language | TypeScript | 5.x strict mode |
| ORM | Prisma | 5.x |
| Primary DB | PostgreSQL | 16 |
| Cache / Sessions | Redis | 7 |
| Search | Elasticsearch | 8 |
| Queue | BullMQ | Latest |
| Auth | Passport.js | JWT + Google OAuth2 + QR |
| Validation | class-validator + class-transformer | Latest |
| File storage | AWS S3 + CloudFront CDN | Latest SDK |
| Push notifications | Firebase Admin SDK (FCM + APNs) | Latest |
| AI | Anthropic Claude API | claude-sonnet-4-20250514 |
| Speech-to-text | AWS Transcribe | Latest SDK |
| Translation | Google Cloud Translate API v3 | Latest |
| Email | Nodemailer | Latest |
| HTTP client | Axios | Latest |

### Frontend

| Layer | Choice | Version |
|---|---|---|
| Framework | Next.js App Router | 14.x |
| Language | TypeScript | 5.x strict mode |
| Styling | Tailwind CSS + shadcn/ui | 3.x |
| Global state | Zustand | Latest |
| Server state | TanStack Query | v5 |
| Forms | React Hook Form + Zod | Latest |
| Canvas / Drawing | Fabric.js | Latest |
| Audio viz | Wavesurfer.js | Latest |
| Video | react-player | Latest |
| Drag-and-drop | @dnd-kit/sortable | Latest |
| Real-time | Socket.io client | Latest |
| i18n | next-intl | Latest |
| Image zoom | react-zoom-pan-pinch | Latest |

### Infrastructure

| Layer | Choice |
|---|---|
| Local dev | Docker + Docker Compose |
| Production | Kubernetes |
| CI/CD | GitHub Actions |
| Monitoring | Datadog APM + Sentry |
| Container registry | AWS ECR |

## Absolute code rules (enforced in every file)

### API response envelope — always use this shape
```typescript
interface ApiResponse<T> {
  success: boolean;
  data: T | null;
  error: string | null;
  meta?: PaginationMeta;
}

interface PaginationMeta {
  cursor?: string;
  hasMore: boolean;
  total?: number;
}
```

### Pagination
- Feeds (journal, messages, submissions): cursor-based (`cursor` + `limit`)
- Admin tables: offset-based (`page` + `limit`)

### NestJS module structure
```
src/
  modules/
    auth/
      dto/
        register.dto.ts
        login.dto.ts
      auth.module.ts
      auth.controller.ts
      auth.service.ts
      auth.service.spec.ts
      jwt.strategy.ts
```
- DTOs always in `/dto` subfolder
- Services hold ALL business logic — controllers are thin routing only
- Never raw SQL in controllers — always Prisma service or repository pattern
- Barrel exports from each module's `index.ts`

### Database conventions
- UUID primary keys: `@default(uuid())`
- Soft delete on every model: `deleted_at DateTime?`
- All models have: `created_at DateTime @default(now())`, `updated_at DateTime @updatedAt`
- Snake_case for all Prisma field names
- Every Prisma query must include `where: { deleted_at: null }` — never return soft-deleted records
- Add Prisma middleware globally to enforce soft-delete filter

### Security rules — non-negotiable
- bcrypt salt rounds: 12
- JWT access token expiry: 15 minutes
- JWT refresh token expiry: 7 days, stored in Redis, HttpOnly cookie
- Refresh token rotation: invalidate old on every `/auth/refresh` call
- S3 media URLs: signed, 7-day expiry — never expose raw S3 URLs
- Rate limiting: 100 req/min global, 5/15min on auth endpoints
- All data in transit: TLS 1.2+
- All data at rest: AES-256
- Input sanitization: strip HTML from all string inputs

### OpenAPI decorators — required on every controller method
```typescript
@ApiTags('auth')
@ApiOperation({ summary: 'Register new user' })
@ApiResponse({ status: 201, description: 'User created' })
@ApiResponse({ status: 409, description: 'Email already exists' })
```

### Error handling
Prisma error codes → HTTP status:
- P2002 (unique constraint) → 409 Conflict
- P2025 (not found) → 404 Not Found
- P2003 (foreign key) → 400 Bad Request
- Unknown → 500 (log to Sentry, never expose stack trace to client)

### Testing requirements
Every service file must have a `.spec.ts` file covering:
- Happy path
- Error cases (not found, duplicate, unauthorized)
- Edge cases specific to the business logic

### No placeholders ever
Never write `// TODO`, `// implement later`, or stub functions that return `null`.
Every method must be fully implemented.
