---
inclusion: fileMatch
fileMatchPattern: ["**/prisma/**", "**/*.service.ts", "**/prisma.service.ts"]
---

## PrismaService — soft-delete middleware

### Location
`src/prisma/prisma.service.ts`

### Responsibility
PrismaService extends PrismaClient and registers a single Prisma middleware
that automatically appends `deleted_at: null` to all read queries on
soft-deletable models.

### Important: findUnique exception
Prisma middleware cannot safely intercept `findUnique` / `findUniqueOrThrow`
without breaking the TypeScript type system (adding `deleted_at` to a unique
where clause changes it to a non-unique filter, causing type errors).
Therefore:
- `findUnique` and `findUniqueOrThrow` are NOT filtered by the middleware
- Services that call `findUnique` MUST manually include `deleted_at: null`
  in the `where` clause themselves
- All other operations (findFirst, findMany, count, aggregate, groupBy)
  are handled automatically by the middleware — do NOT add `deleted_at: null`
  manually in those cases

### Soft-deletable models (update this list when adding new models)
District, School, User, FamilyStudent, Class, ClassTeacher, ClassStudent,
Activity, ActivityAssignment, ActivityTemplate, JournalPost, JournalComment,
Message, FluencyAssessment

### Operations that receive the filter
findUnique, findUniqueOrThrow, findFirst, findFirstOrThrow,
findMany, count, aggregate, groupBy

### Hard-delete guard
Calling `delete` or `deleteMany` on any soft-deletable model must throw
a runtime error. All deletions must go through a service method that sets
`deleted_at = new Date()` instead.

### Soft-delete helper
PrismaService must expose a `softDelete(model, where)` helper method that
sets `deleted_at` and `updated_at`. Services call this instead of
`prisma[model].delete()`.

```typescript
// Correct — always use this
await this.prisma.softDelete('activity', { id: activityId });

// Forbidden — middleware will throw
await this.prisma.activity.delete({ where: { id: activityId } });
```

### Admin escape hatch
For cases where a hard delete is genuinely required (e.g. GDPR erasure),
PrismaService must expose a `hardDelete(model, where)` method that bypasses
the guard. This method must:
- Only be callable by services in the `admin` module
- Log an AuditLog entry before executing
- Never be called from any other module

### Lifecycle
- `onModuleInit`: call `$connect()` and register the middleware
- `onModuleDestroy`: call `$disconnect()`

### Logging
- Log slow queries (> 500ms) at warn level
- Log all Prisma errors at error level
- Never log raw query parameters (may contain PII)