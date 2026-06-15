# Auth Module — Tasks

## Implementation order (follow this sequence exactly)

- [x] Task 1: Prisma schema + PrismaService
  - Confirm User model and all enums exist in schema.prisma
  - Create `src/prisma/prisma.service.ts` with soft-delete middleware
  - Add global Prisma module to app.module.ts
  - Run `prisma migrate dev --name init`

- [x] Task 2: JWT strategy + roles infrastructure
  - Create `jwt.strategy.ts` — validates Bearer token, returns JwtPayload
  - Create `roles.decorator.ts` — @Roles(...) custom decorator
  - Create `roles.guard.ts` — reads @Roles, checks req.user.role
  - Create `jwt-auth.guard.ts` — extends AuthGuard('jwt')

- [x] Task 3: DTOs
  - `register.dto.ts` — email, password (min 8), firstName, lastName
  - `login.dto.ts` — email, password
  - `qr-login.dto.ts` — token (string)
  - All with class-validator decorators and @ApiProperty

- [x] Task 4: AuthService — core methods
  - `register(dto)` — hash password, create user, return tokens
  - `login(dto)` — find user, compare hash, return tokens
  - `refreshToken(userId, token)` — validate Redis, rotate tokens
  - `logout(userId)` — delete Redis key, clear cookie
  - `generateTokens(user)` — private method, creates access + refresh pair
  - Full unit tests in auth.service.spec.ts

- [x] Task 5: Google OAuth
  - `google.strategy.ts` — GoogleStrategy with profile mapping
  - `validateGoogleUser(profile)` in AuthService — upsert user
  - Google callback controller methods

- [x] Task 6: QR code login
  - `qr.service.ts` — generateQr(teacherId, studentId) + validateQr(token)
  - `qr.controller.ts` — POST /auth/student-qr/:studentId and POST /auth/qr-login
  - Full unit tests in qr.service.spec.ts

- [x] Task 7: AuthController + rate limiting
  - Wire all endpoints in auth.controller.ts
  - Add @Throttle({ default: { limit: 5, ttl: 900000 } }) on login endpoint
  - Add global ThrottlerModule to app.module.ts

- [x] Task 8: Auth module wiring
  - auth.module.ts imports: JwtModule, PassportModule, ThrottlerModule
  - Export JwtAuthGuard and RolesGuard for use in other modules
  - Add AuthModule to app.module.ts imports

- [x] Task 9: E2E test
  - `test/auth.e2e-spec.ts`
  - Test: register → login → refresh → logout flow
  - Test: Google OAuth callback with mock profile
  - Test: rate limiting (6th attempt returns 429)
