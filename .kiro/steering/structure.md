---
inclusion: always
---

# EduFlow — Project Structure

## Repository layout

Legend: ✅ exists on disk | 🔲 not yet scaffolded

```
eduflow/
├── apps/
│   ├── api/                        # ✅ NestJS backend
│   │   ├── src/
│   │   │   ├── modules/            # Feature modules (one folder per domain)
│   │   │   │   ├── auth/           # ✅ complete
│   │   │   │   ├── uploads/        # ✅ complete
│   │   │   │   ├── classes/        # ✅ complete
│   │   │   │   ├── activities/     # ✅ complete
│   │   │   │   ├── submissions/    # ✅ complete
│   │   │   │   ├── journal/        # ✅ complete
│   │   │   │   ├── assessment/     # ✅ complete
│   │   │   │   ├── messages/       # ✅ complete
│   │   │   │   ├── notifications/  # ✅ complete
│   │   │   │   ├── library/        # ✅ complete
│   │   │   │   ├── ai/             # ✅ complete (12 AI features)
│   │   │   │   ├── clever/         # ✅ complete (cron scheduling pending)
│   │   │   │   ├── fluency/        # 🔲 not scaffolded
│   │   │   │   └── admin/          # 🔲 not scaffolded
│   │   │   ├── common/             # ✅ Shared utilities
│   │   │   │   ├── decorators/     # ✅
│   │   │   │   ├── filters/        # ✅ Global exception filter
│   │   │   │   ├── guards/         # ✅ RolesGuard, JwtGuard
│   │   │   │   ├── interceptors/   # ✅ Logging interceptor
│   │   │   │   ├── pipes/          # ✅ Validation pipe
│   │   │   │   └── types/          # ✅ Shared TypeScript types
│   │   │   ├── prisma/             # ✅ PrismaService + middleware
│   │   │   └── main.ts             # ✅ Bootstrap
│   │   ├── prisma/
│   │   │   ├── schema.prisma       # ✅ Single source of truth for DB
│   │   │   └── migrations/
│   │   └── test/                   # 🔲 E2E tests (not yet created)
│   └── web/                        # 🔲 Next.js frontend (not yet scaffolded)
│       ├── app/                    # App Router pages
│       │   ├── (teacher)/          # Teacher route group
│       │   ├── (student)/          # Student route group
│       │   ├── (family)/           # Family route group
│       │   └── (admin)/            # Admin route group
│       ├── components/             # Shared React components
│       │   ├── ui/                 # shadcn/ui base components
│       │   ├── canvas/             # Drawing canvas components
│       │   ├── recording/          # Audio/video recorder components
│       │   └── journal/            # Journal/portfolio components
│       ├── lib/                    # Utilities, API client
│       ├── stores/                 # Zustand stores
│       ├── hooks/                  # Custom React hooks
│       └── types/                  # Shared TypeScript types
├── packages/
│   └── shared/                     # 🔲 Types shared between api and web (not yet created)
├── docker-compose.yml
├── .kiro/
│   ├── steering/                   # These files — Kiro context
│   ├── hooks/                      # Automated triggers
│   └── specs/                      # Feature specs (generated per task)
└── AGENTS.md                       # Top-level Kiro instructions
```

## Module anatomy — every NestJS module follows this pattern

```
modules/auth/
  dto/
    register.dto.ts       # Input validation for POST /auth/register
    login.dto.ts          # Input validation for POST /auth/login
  auth.module.ts          # Module definition, imports, providers
  auth.controller.ts      # HTTP handlers only — no business logic
  auth.service.ts         # ALL business logic
  auth.service.spec.ts    # Unit tests for auth.service
  jwt.strategy.ts         # Passport JWT strategy
  google.strategy.ts      # Passport Google OAuth strategy
  index.ts                # Barrel exports
```

## Naming conventions

| Thing | Convention | Example |
|---|---|---|
| Files | kebab-case | `activity-builder.service.ts` |
| Classes | PascalCase | `ActivityBuilderService` |
| Methods / variables | camelCase | `createActivity()` |
| DB columns | snake_case | `created_at` |
| API routes | kebab-case | `/api/v1/activity-blocks` |
| Env variables | UPPER_SNAKE | `JWT_SECRET` |
| Zustand stores | camelCase + Store suffix | `useActivityBuilderStore` |
| React components | PascalCase | `DrawingCanvas.tsx` |
| Custom hooks | camelCase + use prefix | `useDrawingHistory.ts` |

## API versioning

All endpoints are prefixed `/api/v1/`. Example:
- `POST /api/v1/auth/login`
- `GET /api/v1/classes`
- `POST /api/v1/activities/:id/publish`

## Environment variables (never hardcode these)

```
# Database
DATABASE_URL=postgresql://...
REDIS_URL=redis://...
ELASTICSEARCH_URL=http://...

# Auth
JWT_SECRET=
JWT_REFRESH_SECRET=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
CLEVER_CLIENT_ID=
CLEVER_CLIENT_SECRET=

# AWS
AWS_REGION=
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
S3_BUCKET_NAME=
CLOUDFRONT_DOMAIN=

# Firebase
FIREBASE_PROJECT_ID=
FIREBASE_PRIVATE_KEY=
FIREBASE_CLIENT_EMAIL=

# AI / Translation
OPENROUTER_API_KEY=
GOOGLE_TRANSLATE_API_KEY=

# App
ALLOWED_ORIGINS=
NODE_ENV=
PORT=3001
```

## Current build status

Track what is done so Kiro never regenerates completed modules:

- [x] Phase 1 — Foundation: Auth ✓, Uploads ✓, Classes ✓
- [x] Phase 2 — Core Learning: Activities ✓, Submissions ✓
- [x] Phase 3 — Portfolio: Journal ✓, Assessment ✓
- [x] Phase 4 — Communication: Messaging ✓, Notifications ✓
- [x] Phase 5 — Discovery: Content Library ✓, AI Generator ✓
- [ ] Phase 6 — Admin & Integrations: Admin Portal, Clever SSO (partial), Fluency

**Completed Modules (backend):**
- ✅ Auth (JWT, Google OAuth, QR login, rate limiting, mail service)
- ✅ Uploads (S3 presigned URLs, CloudFront signed URLs)
- ✅ Classes (CRUD, co-teachers, roster import, family invites, class codes)
- ✅ Activities (builder, 13 block types, publish, schedule, WebSocket gateway)
- ✅ Submissions (student responses, auto-grading, revision history, teacher feedback)
- ✅ Journal (digital portfolio, approval gate, reactions, comments, auto-post from submissions)
- ✅ Assessment (feedback, annotations, class analytics, student progress)
- ✅ Messaging (threads, real-time WebSocket, Google Translate, unread counts)
- ✅ Notifications (FCM push, device registration, preferences, activity reminders)
- ✅ Library (Elasticsearch search, template copy/publish/rate, BullMQ sync)
- ✅ AI Generator (12 AI features, OpenRouter integration, rate limiting, unit tests)
- ✅ Clever SSO (OAuth flow, roster sync job — cron scheduling pending)

**Partial / pending backend work:**
- ⚠️ Clever SSO — Task 7 (cron scheduling) not implemented
- 🔲 Fluency — not scaffolded (FluencyAssessment model exists in schema)
- 🔲 Admin — not scaffolded

**Frontend:**
- 🔲 apps/web/ — Next.js frontend not yet scaffolded (all frontend tasks pending across all modules)

Update this checklist as modules are completed.
