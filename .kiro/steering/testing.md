---
inclusion: fileMatch
fileMatchPattern: ["**/*.spec.ts", "**/*.test.ts", "**/test/**"]
---

# EduFlow — Testing Standards

## Unit test structure (every .service.spec.ts)

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';

describe('AuthService', () => {
  let service: AuthService;
  let prisma: jest.Mocked<PrismaService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: PrismaService,
          useValue: {
            user: {
              findUnique: jest.fn(),
              create: jest.fn(),
              update: jest.fn(),
            },
          },
        },
        {
          provide: JwtService,
          useValue: { sign: jest.fn().mockReturnValue('mock-token') },
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    prisma = module.get(PrismaService);
  });

  describe('login', () => {
    it('should return tokens for valid credentials', async () => {
      // arrange
      prisma.user.findUnique.mockResolvedValue(mockUser);
      // act
      const result = await service.login(validLoginDto);
      // assert
      expect(result.accessToken).toBeDefined();
    });

    it('should throw UnauthorizedException for wrong password', async () => {
      prisma.user.findUnique.mockResolvedValue(mockUser);
      await expect(service.login(wrongPasswordDto))
        .rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException for deactivated account', async () => {
      prisma.user.findUnique.mockResolvedValue({ ...mockUser, is_active: false });
      await expect(service.login(validLoginDto))
        .rejects.toThrow(UnauthorizedException);
    });
  });
});
```

## What to test in every service

1. **Happy path** — correct input produces correct output
2. **Not found** — throws NotFoundException when record doesn't exist
3. **Unauthorized** — throws ForbiddenException when user lacks permission
4. **Duplicate** — throws ConflictException on unique constraint violations
5. **Validation edge cases** — boundary values, empty inputs, null handling
6. **Side effects** — emails sent, jobs enqueued, WebSocket events emitted

## Frontend component tests (React Testing Library)

```typescript
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DrawingCanvas } from './DrawingCanvas';

describe('DrawingCanvas', () => {
  it('renders toolbar with all required tools', () => {
    render(<DrawingCanvas onSave={jest.fn()} />);
    expect(screen.getByRole('button', { name: /pencil/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /eraser/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /undo/i })).toBeInTheDocument();
  });

  it('calls onSave with fabric json after auto-save interval', async () => {
    const onSave = jest.fn();
    render(<DrawingCanvas onSave={onSave} />);
    await waitFor(() => expect(onSave).toHaveBeenCalled(), { timeout: 25000 });
  });
});
```

## Test file location

- Backend: `src/modules/auth/auth.service.spec.ts` (co-located with service)
- Frontend: `components/canvas/DrawingCanvas.test.tsx` (co-located with component)
- E2E: `apps/api/test/auth.e2e-spec.ts`

## Mocking rules

- Always mock Prisma — never hit real database in unit tests
- Always mock external services (S3, FCM, Claude API, Google Translate)
- Use `jest.fn()` for all mocks — never use `any` type for mocked values
- Reset all mocks in `beforeEach` using `jest.clearAllMocks()`

## Coverage expectations

- Services: minimum 80% line coverage
- Critical paths (auth, submissions, billing): 95%+ coverage
- Frontend hooks: minimum 70% coverage
- Controllers: covered via E2E tests, not unit tests
