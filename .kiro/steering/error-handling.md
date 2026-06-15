---
inclusion: always
---

# EduFlow — Error Handling

## Global exception filter

Location: `src/common/filters/http-exception.filter.ts`

All unhandled exceptions pass through this filter. It normalises every error
into the standard API response envelope and ensures stack traces never reach
the client.

```typescript
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();
      message = typeof res === 'string' ? res : (res as any).message ?? message;
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      const mapped = PRISMA_ERROR_MAP[exception.code];
      if (mapped) {
        status = mapped.status;
        message = mapped.message;
      } else {
        // Unknown Prisma error — log to Sentry, return generic 500
        Sentry.captureException(exception);
      }
    } else {
      // Unexpected error — always log to Sentry
      Sentry.captureException(exception);
    }

    response.status(status).json({
      success: false,
      data: null,
      error: message,
    });
  }
}
```

## Prisma error code → HTTP status map

| Prisma code | Meaning | HTTP status | Response message |
|---|---|---|---|
| P2002 | Unique constraint violation | 409 Conflict | 'Resource already exists' |
| P2025 | Record not found | 404 Not Found | 'Resource not found' |
| P2003 | Foreign key constraint | 400 Bad Request | 'Invalid reference' |
| P2014 | Relation violation | 400 Bad Request | 'Invalid relation' |
| P2016 | Query interpretation error | 400 Bad Request | 'Invalid query' |
| All others | Unknown DB error | 500 Internal Server Error | 'Internal server error' |

## Registration

Register `AllExceptionsFilter` globally in `main.ts`:

```typescript
app.useGlobalFilters(new AllExceptionsFilter());
```

## Rules

- NEVER expose stack traces, Prisma internals, or SQL in any response
- NEVER log PII (email, student name) in error messages or Sentry metadata
- ALWAYS capture unexpected errors (non-HttpException, unknown Prisma codes) via Sentry
- ALWAYS return the standard `{ success, data, error }` envelope — even for errors
- Validation errors from the global ValidationPipe return 400 with the
  class-validator message array — this is handled automatically by NestJS

## Sentry setup

Initialise Sentry in `main.ts` before the app starts:

```typescript
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV,
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.2 : 1.0,
});
```

Add `SENTRY_DSN` to `.env.example` when the Sentry project is created.

## Logging levels

| Situation | Level |
|---|---|
| Request handled successfully | `log` |
| Slow query > 500ms | `warn` |
| Redis failure | `warn` |
| 4xx client error | `warn` |
| 5xx server error | `error` |
| Sentry-reported exception | `error` |
