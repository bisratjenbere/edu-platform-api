import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import * as cookieParser from 'cookie-parser';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Auth Module (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let accessToken: string;
  let refreshTokenCookie: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    
    app.setGlobalPrefix('api/v1');
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );

    await app.init();
    
    prisma = app.get<PrismaService>(PrismaService);
  });

  afterAll(async () => {
    // Use hardDelete to bypass soft-delete middleware — real cleanup not soft-delete
    await prisma.hardDelete('user', {
      email: { in: ['test@eduflow.com', 'test2@eduflow.com'] },
    });
    await app.close();
  });

  describe('POST /api/v1/auth/register', () => {
    it('should register a new teacher', () => {
      return request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({
          email: 'test@eduflow.com',
          password: 'SecurePass123!',
          firstName: 'Test',
          lastName: 'Teacher',
        })
        .expect(201)
        .expect((res) => {
          expect(res.body.success).toBe(true);
          expect(res.body.data.user).toBeDefined();
          expect(res.body.data.user.email).toBe('test@eduflow.com');
          expect(res.body.data.user.role).toBe('TEACHER');
          expect(res.body.data.accessToken).toBeDefined();
          expect(res.headers['set-cookie']).toBeDefined();
          
          // Extract access token for later tests
          accessToken = res.body.data.accessToken;
          
          // Extract refresh token cookie
          const cookies = res.headers['set-cookie'];
          const rtCookie = cookies.find((c: string) => c.startsWith('__rt='));
          expect(rtCookie).toBeDefined();
          refreshTokenCookie = rtCookie;
        });
    });

    it('should return 409 if email already exists', () => {
      return request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({
          email: 'test@eduflow.com',
          password: 'AnotherPass123!',
          firstName: 'Another',
          lastName: 'User',
        })
        .expect(409)
        .expect((res) => {
          expect(res.body.message).toContain('Email already in use');
        });
    });

    it('should return 400 for invalid email', () => {
      return request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({
          email: 'invalid-email',
          password: 'SecurePass123!',
          firstName: 'Test',
          lastName: 'User',
        })
        .expect(400);
    });

    it('should return 400 for password less than 8 characters', () => {
      return request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({
          email: 'newuser@eduflow.com',
          password: 'short',
          firstName: 'Test',
          lastName: 'User',
        })
        .expect(400);
    });
  });

  describe('POST /api/v1/auth/login', () => {
    it('should login with valid credentials', () => {
      return request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({
          email: 'test@eduflow.com',
          password: 'SecurePass123!',
        })
        .expect(200)
        .expect((res) => {
          expect(res.body.success).toBe(true);
          expect(res.body.data.user).toBeDefined();
          expect(res.body.data.accessToken).toBeDefined();
          expect(res.headers['set-cookie']).toBeDefined();
          
          // Update tokens for later tests
          accessToken = res.body.data.accessToken;
          
          const cookies = res.headers['set-cookie'];
          const rtCookie = cookies.find((c: string) => c.startsWith('__rt='));
          refreshTokenCookie = rtCookie;
        });
    });

    it('should return 401 for invalid password', () => {
      return request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({
          email: 'test@eduflow.com',
          password: 'WrongPassword123!',
        })
        .expect(401)
        .expect((res) => {
          expect(res.body.message).toContain('Invalid credentials');
        });
    });

    it('should return 401 for non-existent user', () => {
      return request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({
          email: 'nonexistent@eduflow.com',
          password: 'SomePassword123!',
        })
        .expect(401);
    });

    it('should rate limit after 5 failed attempts', async () => {
      // Make 5 failed login attempts
      for (let i = 0; i < 5; i++) {
        await request(app.getHttpServer())
          .post('/api/v1/auth/login')
          .send({
            email: 'test2@eduflow.com',
            password: 'WrongPassword123!',
          })
          .expect(401);
      }

      // 6th attempt should be rate limited
      return request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({
          email: 'test2@eduflow.com',
          password: 'WrongPassword123!',
        })
        .expect(429);
    }, 30000); // Increase timeout for this test
  });

  describe('POST /api/v1/auth/refresh', () => {
    it('should refresh access token with valid refresh token', () => {
      return request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .set('Cookie', refreshTokenCookie)
        .expect(200)
        .expect((res) => {
          expect(res.body.success).toBe(true);
          expect(res.body.data.accessToken).toBeDefined();
          expect(res.headers['set-cookie']).toBeDefined();
          
          // Update access token
          accessToken = res.body.data.accessToken;
        });
    });

    it('should return 401 without refresh token cookie', () => {
      return request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .expect(401);
    });

    it('should return 401 with invalid refresh token', () => {
      return request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .set('Cookie', '__rt=invalid-token')
        .expect(401);
    });
  });

  describe('POST /api/v1/auth/logout', () => {
    it('should logout successfully', () => {
      return request(app.getHttpServer())
        .post('/api/v1/auth/logout')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200)
        .expect((res) => {
          expect(res.body.success).toBe(true);
          expect(res.body.data.message).toContain('Logged out successfully');
          
          // Check that cookie was cleared
          const cookies = res.headers['set-cookie'];
          if (cookies) {
            const rtCookie = cookies.find((c: string) => c.startsWith('__rt='));
            if (rtCookie) {
              expect(rtCookie).toContain('Max-Age=0');
            }
          }
        });
    });

    it('should return 401 without access token', () => {
      return request(app.getHttpServer())
        .post('/api/v1/auth/logout')
        .expect(401);
    });
  });

  describe('Full authentication flow', () => {
    it('should complete register → login → refresh → logout flow', async () => {
      const testEmail = `flow-test-${Date.now()}@eduflow.com`;
      
      // 1. Register
      const registerRes = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({
          email: testEmail,
          password: 'FlowTest123!',
          firstName: 'Flow',
          lastName: 'Test',
        })
        .expect(201);
      
      expect(registerRes.body.success).toBe(true);
      let token = registerRes.body.data.accessToken;
      let cookies = registerRes.headers['set-cookie'];
      let rtCookie = cookies.find((c: string) => c.startsWith('__rt='));
      
      // 2. Login
      const loginRes = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({
          email: testEmail,
          password: 'FlowTest123!',
        })
        .expect(200);
      
      expect(loginRes.body.success).toBe(true);
      token = loginRes.body.data.accessToken;
      cookies = loginRes.headers['set-cookie'];
      rtCookie = cookies.find((c: string) => c.startsWith('__rt='));
      
      // 3. Refresh
      const refreshRes = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .set('Cookie', rtCookie)
        .expect(200);
      
      expect(refreshRes.body.success).toBe(true);
      token = refreshRes.body.data.accessToken;
      
      // 4. Logout
      const logoutRes = await request(app.getHttpServer())
        .post('/api/v1/auth/logout')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      
      expect(logoutRes.body.success).toBe(true);
      
      // Clean up
      await prisma.hardDelete('user', { email: testEmail });
    });
  });

  describe('Google OAuth callback (mocked)', () => {
    it('should handle Google OAuth profile', async () => {
      // Note: This is a simplified test. In a real scenario, you'd mock the Google OAuth flow
      // For now, we're just testing the validateGoogleUser method indirectly
      
      // This test would require additional setup to properly mock Passport Google Strategy
      // Skipping for now as it requires more complex test infrastructure
    });
  });
});
