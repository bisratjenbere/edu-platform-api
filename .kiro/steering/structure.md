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
│   │   │   │   ├── classes/        # ✅ DTOs only — no service/controller yet
│   │   │   │   ├── activities/     # 🔲 not scaffolded
│   │   │   │   ├── submissions/    # 🔲 not scaffolded
│   │   │   │   ├── journal/        # 🔲 not scaffolded
│   │   │   │   ├── messages/       # 🔲 not scaffolded
│   │   │   │   ├── notifications/  # 🔲 not scaffolded
│   │   │   │   ├── library/        # 🔲 not scaffolded
│   │   │   │   ├── ai/             # 🔲 not scaffolded
│   │   │   │   ├── fluency/        # 🔲 not scaffolded
│   │   │   │   ├── admin/          # 🔲 not scaffolded
│   │   │   │   └── clever/         # 🔲 not scaffolded
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
- [ ] Phase 2 — Core Learning: Activities, Submissions
- [ ] Phase 3 — Portfolio: Journal, Assessment
- [ ] Phase 4 — Communication: Messaging, Notifications
- [ ] Phase 5 — Discovery: Content Library, AI Generator
- [ ] Phase 6 — Admin & Integrations: Admin Portal, Clever SSO, Fluency

**Completed Modules:**
- ✅ Auth (authentication, JWT, Google OAuth, QR login)
- ✅ Uploads (S3 presigned URLs, CloudFront signed URLs)
- ✅ Classes (class management, co-teachers, roster import, family invites, class codes)

Update this checklist as modules are completed.
