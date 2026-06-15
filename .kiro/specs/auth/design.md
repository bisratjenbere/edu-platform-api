# Auth Module — Design

## Architecture

```
POST /api/v1/auth/register       → AuthController → AuthService.register()
POST /api/v1/auth/login          → AuthController → AuthService.login()
POST /api/v1/auth/refresh        → AuthController → AuthService.refreshToken()
POST /api/v1/auth/logout         → AuthController → AuthService.logout()
GET  /api/v1/auth/google         → AuthController → GoogleStrategy (redirect)
GET  /api/v1/auth/google/callback → AuthController → AuthService.validateGoogleUser()
POST /api/v1/auth/student-qr/:id → QrController  → QrService.generateQr()
POST /api/v1/auth/qr-login       → QrController  → QrService.validateQr()
```

## Data models

Uses existing `User` model from database-schema.md.

Redis keys:
- `refresh:{userId}` → plain refresh token string (TTL: 7 days)
- `used_qr:{token}` → "1" (TTL: 60 seconds — must equal token lifetime exactly)
- `login_attempts:{ip}` → attempt count (TTL: 15 minutes)

QR single-use enforcement sequence (order is non-negotiable):
1. Validate JWT signature and expiry (rejects tokens older than 60s)
2. Check Redis: if `used_qr:{token}` exists → return 401 immediately
3. Set `used_qr:{token}` = "1" with TTL 60s BEFORE issuing session
4. Issue student session

No grace period. TTL = 60s exactly — equal to token lifetime. Do not add grace periods.

## Token design

```typescript
// Access token payload
interface JwtPayload {
  sub: string;      // userId
  email: string;
  role: Role;
  schoolId: string | null;
  iat: number;
  exp: number;
}

// QR token payload
interface QrPayload {
  studentId: string;
  classId: string;
  type: 'QR_LOGIN';
  iat: number;
  exp: number; // now + 60 seconds
}
```

## File structure

```
src/modules/auth/
  dto/
    register.dto.ts
    login.dto.ts
    qr-login.dto.ts
  auth.module.ts
  auth.controller.ts
  auth.service.ts
  auth.service.spec.ts
  qr.controller.ts
  qr.service.ts
  qr.service.spec.ts
  jwt.strategy.ts
  google.strategy.ts
  roles.guard.ts
  roles.decorator.ts
  index.ts
```

## Key dependencies

- `@nestjs/passport`, `passport`, `passport-jwt`, `passport-google-oauth20`
- `@nestjs/jwt`
- `bcrypt` + `@types/bcrypt`
- `qrcode` (QR image generation)
- `ioredis` (Redis client)

## Security decisions

- Refresh token returned in JSON response body by AuthService — AuthController is responsible
  for setting it as HttpOnly, Secure, SameSite=Strict cookie named `__rt` before sending response
- Refresh token stored as plain string in Redis (not hashed) — key: `refresh:{userId}`
- Refresh token rotation: every refresh call issues new pair, invalidates old Redis key first
- QR tokens: single-use enforced via Redis, TTL = 60s (equal to token lifetime, no grace period)
- Rate limiting: @nestjs/throttler, 5 attempts / 15 min per IP on /auth/login
- Passwords: bcrypt, 12 salt rounds
- Google OAuth: callback validates state param to prevent CSRF
