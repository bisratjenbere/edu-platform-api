# EduFlow — Kiro Agent Instructions

## What you are building

EduFlow is a production-grade K–12 Learning Experience Platform (LXP) — functionally
equivalent to Seesaw. It serves teachers, students (PreK–Grade 5), and families
through digital portfolios, activity-based learning, and two-way communication.

This is a real production system. Write production-quality code every time.
No stubs. No placeholders. No "// TODO". Every method fully implemented.

---

## Your steering files — read these for every task

All context lives in `.kiro/steering/`. These files are always active:

| File | What it contains |
|---|---|
| `product.md` | What EduFlow is, user roles, feature areas, constraints |
| `tech.md` | Full tech stack, code style rules, security rules, API envelope |
| `structure.md` | Folder layout, module anatomy, naming conventions, build status |
| `database-schema.md` | Complete Prisma schema — NEVER redefine existing models |
| `security.md` | Auth rules, RBAC, input sanitization, audit logging |
| `api-standards.md` | Response envelope, pagination, DTO standards, HTTP status codes |
| `testing.md` | Unit test structure, what to test, coverage expectations |
| `frontend.md` | Component anatomy, Tailwind rules, shadcn/ui, TanStack Query, Zustand |
| `redis-key.md` | Every Redis key name, value shape, TTL, and ownership rule |
| `prisma-middleware.md` | Soft-delete middleware rules, findUnique exception, hardDelete guard |
| `block-content-schemas.md` | Zod schemas for every ActivityBlock content type |
| `error-handling.md` | Global exception filter, Prisma error → HTTP status map, Sentry logging |

---

## Your spec files — one per module

All feature specs live in `.kiro/specs/`. Each has requirements, design, and tasks.

| Module | Spec location | Phase |
|---|---|---|
| Auth | `.kiro/specs/auth/` | 1 — build first |
| Uploads | `.kiro/specs/uploads/` | 1 — shared dependency |
| Classes | `.kiro/specs/classes/` | 1 |
| Activities | `.kiro/specs/activities/` | 2 |
| Submissions | `.kiro/specs/submissions/` | 2 |
| Journal | `.kiro/specs/journal/` | 3 |
| Assessment | `.kiro/specs/assessment/` | 3 |
| Messaging | `.kiro/specs/messaging/` | 4 |
| Notifications | `.kiro/specs/notifications/` | 4 |
| Library | `.kiro/specs/library/` | 5 |
| AI Generator | `.kiro/specs/ai-generator/` | 5 |
| Admin | `.kiro/specs/admin/` | 6 |
| Clever SSO | `.kiro/specs/clever-sso/` | 6 |
| Fluency | `.kiro/specs/fluency/` | 6 |

---

## How to work on a module

### Step 1 — Start a spec session
When told "work on [module]", first read:
1. The module's spec files in `.kiro/specs/[module]/`
2. `database-schema.md` to understand existing models
3. `structure.md` to check what's already built

### Step 2 — Clarify before coding
Ask ONE clarifying question if something in the spec is ambiguous.
Do not ask multiple questions. Make reasonable assumptions for everything else
and state them clearly at the start of your response.

### Step 3 — Follow the tasks list
Execute tasks in the order listed in the spec's tasks.md.
Check off tasks as they are completed.
Do not skip tasks or reorder them without reason.

### Step 4 — Update the schema steering file
After adding any new Prisma models, update `.kiro/steering/database-schema.md`
immediately. Other modules depend on this file being current.

### Step 5 — Update build status
After completing a module, update the checklist in `.kiro/steering/structure.md`.

---

## Rules you must always follow

1. **Never redefine existing Prisma models** — always check database-schema.md first
2. **Never return soft-deleted records** — every query must include `where: { deleted_at: null }`
3. **Never expose password_hash** — always exclude it from response objects
4. **Never skip auth guards** — every controller endpoint needs JwtAuthGuard + RolesGuard
5. **Never use raw SQL** in controllers — always use Prisma service
6. **Never use `any` type** — TypeScript strict mode is non-negotiable
7. **Never write stub functions** — if a method is listed, implement it fully
8. **Always write the spec file for the corresponding module** — code must follow spec
9. **Always add OpenAPI decorators** on every controller method
10. **Always co-locate test files** — auth.service.spec.ts lives next to auth.service.ts

---

## Module dependency order (critical)

```
Uploads (S3 presigned URLs) ──┐
Auth (JWT, roles, guards) ─────┼──► Classes ──► Activities ──► Submissions ──► Journal
                               │                                               │
Error handling + Security ─────┘                                               ▼
                                                                          Assessment
                                                                               │
                                                                         Messaging ──► Notifications
                                                                               │
                                                                    Library ──► AI Generator
                                                                               │
                                                              Admin ──► Clever SSO ──► Fluency
```

Do NOT start a module before its dependencies are complete.

---

## BullMQ conventions

Several modules use BullMQ for async jobs and scheduled tasks. Follow these rules consistently.

### Queue names (single source of truth — never invent new names)

| Queue name | Used by | Purpose |
|---|---|---|
| `activity-scheduler` | Activities | Delayed publish jobs |
| `push-notifications` | Notifications | FCM/APNs delivery, 3 retries |
| `roster-import` | Classes | Async CSV roster processing |
| `translations` | Messaging | Google Translate calls |
| `library-sync` | Library | Elasticsearch upsert on template publish |
| `fluency-analysis` | Fluency | AWS Transcribe + word comparison |

### Job naming convention
`{verb}-{resource}:{resourceId}` — e.g. `publish-activity:abc123`, `remind-student:xyz789`

### Retry policy (default for all queues unless noted)
- attempts: 3
- backoff: { type: 'exponential', delay: 5000 }
- removeOnComplete: true
- removeOnFail: false (keep for inspection)

### Registration rule
Register each BullMQ processor in its own module's `.module.ts` using
`BullModule.registerQueue({ name: 'queue-name' })`. Never register queues
in `app.module.ts` directly.

### Shared BullMQ config
Configure Redis connection once in a shared `BullModule.forRootAsync()` in
`app.module.ts` reading from `REDIS_URL` env var.

---

## How to handle the AI integration

For the AI Generator module, use this API configuration:
- Provider: OpenRouter — single API key, OpenAI-compatible interface
- Endpoint: `https://openrouter.ai/api/v1/chat/completions`
- Model: `meta-llama/llama-3.3-70b-instruct:free` (free tier, no cost)
- max_tokens: 2000
- The API key comes from environment variable: `OPENROUTER_API_KEY`
- Required extra headers: `HTTP-Referer: https://eduflow.app` and `X-Title: EduFlow`
- Never hardcode API keys
- Always validate AI responses with Zod before using them
- Always handle JSON parse failures with a retry (see ai-generator/design.md)

---

## Environment setup reminder

Before running any code, ensure these services are running locally:
```bash
docker compose up -d  # starts PostgreSQL, Redis, Elasticsearch
cd apps/api && npx prisma migrate dev  # apply migrations
```

Docker Compose file is at the project root. It must include:
- postgres:16-alpine on host port **5434** (container port 5432)
- redis:7-alpine on port 6379
- elasticsearch:8 on port 9200

Note: DATABASE_URL must use port 5434 locally, e.g. `postgresql://eduflow:eduflow@localhost:5434/eduflow`

---

## When you are unsure

1. Read the relevant steering file again
2. Check if a similar pattern exists in an already-built module
3. Ask one specific question — not multiple
4. Default to the most secure option when security decisions are ambiguous
5. Default to the simpler implementation when architecture decisions are ambiguous

The spec is the source of truth. Code must match the spec.
If the spec is unclear, improve the spec first, then write code.

---

## Git workflow

### Branch strategy

Never commit directly to `main`. Every module gets its own feature branch.

| Branch name | When to create |
|---|---|
| `feature/auth` | Starting auth module work |
| `feature/uploads` | Starting uploads module work |
| `feature/classes` | Starting classes module work |
| `feature/activities` | Starting activities module work |
| `feature/<module>` | Pattern for every subsequent module |
| `fix/<short-description>` | Bug fixes discovered outside active module work |
| `chore/<short-description>` | Config, tooling, dependency updates |
| `docs/<short-description>` | Documentation-only changes |

Create the branch before writing any code:
```bash
git checkout main && git pull
git checkout -b feature/<module>
```

Merge to main only when the module is fully complete and all tests pass:
```bash
git checkout main
git merge --no-ff feature/<module> -m "feat(<module>): complete <module> module"
git push origin main
```

---

### Commit types (conventional commits)

| Type | When to use |
|---|---|
| `feat` | New functionality — service methods, controllers, DTOs |
| `fix` | Bug fix in existing code |
| `refactor` | Code restructure with no behaviour change |
| `test` | Adding or fixing tests only |
| `chore` | Dependencies, config, tooling, migrations |
| `docs` | Steering files, spec files, README, comments |
| `perf` | Performance improvement |

---

### Commit message format

```
<type>(<scope>): <short summary in present tense, max 72 chars>

[optional body — what changed and why, not how]
```

Scope = module name: `auth`, `uploads`, `classes`, `activities`, etc.

Examples:
```
feat(auth): add JWT refresh token rotation with Redis
fix(auth): prevent double token generation in login controller
test(auth): fix refreshToken spec to use plain string comparison
chore(prisma): add FamilyStudent and ClassCode migration
docs(steering): add git workflow section to AGENTS.md
refactor(auth): type generateTokens parameter, remove any usage
```

---

### When to commit

Commit after each meaningful, self-contained unit of work. Do NOT wait until
an entire module is done to make one giant commit. Use this granularity:

| Unit of work | Commit |
|---|---|
| Prisma schema change + migration | `chore(<module>): add <Model> model and migration` |
| All DTOs for a module | `feat(<module>): add request/response DTOs with validation` |
| Service fully implemented | `feat(<module>): implement <Module>Service with all methods` |
| Controller fully wired | `feat(<module>): add <Module>Controller with guards and OpenAPI` |
| Unit tests written/fixed | `test(<module>): add unit tests for <Module>Service` |
| E2E tests written | `test(<module>): add e2e tests for <module> endpoints` |
| Steering/spec file updated | `docs(steering): update <file> with <what changed>` |
| Bug fix | `fix(<module>): <what was wrong and what was fixed>` |

---

### Rules

1. **Never commit broken TypeScript** — run `npx tsc --noEmit` before every commit
2. **Never commit failing tests** — run `npm test` before every commit
3. **Never mix unrelated changes** — one concern per commit
4. **Never force-push to main**
5. **Always run migrations before committing schema changes** — commit the migration files alongside schema.prisma
6. **Commit spec/steering updates in the same commit as the code they describe** — keeps docs and code in sync
7. **Write commit messages in present tense** — "add", "fix", "update", not "added", "fixed"

---

### Pre-commit checklist

Before every `git commit`, verify:

```bash
# 1. TypeScript clean
npx tsc --noEmit

# 2. Tests pass
npm test

# 3. No secrets or .env files staged
git diff --cached --name-only

# 4. Only related files staged
git status
```

---

### Module completion checklist (before merging to main)

- [ ] All tasks in `.kiro/specs/<module>/tasks.md` checked off
- [ ] `npx tsc --noEmit` — zero errors
- [ ] `npm test` — all tests pass
- [ ] `structure.md` build status updated
- [ ] `database-schema.md` updated if new models were added
- [ ] Prisma migration created and committed
- [ ] Feature branch merged to main with `--no-ff`
