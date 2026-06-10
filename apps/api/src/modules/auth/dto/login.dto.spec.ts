import { validate } from 'class-validator';
import { plainToClass } from 'class-transformer';
import { LoginDto } from './login.dto';

describe('LoginDto', () => {
  it('should pass validation with valid data', async () => {
    const dto = plainToClass(LoginDto, {
      email: 'teacher@school.edu',
      password: 'SecurePass123!',
    });

    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  describe('email', () => {
    it('should fail if email is missing', async () => {
      const dto = plainToClass(LoginDto, {
        password: 'SecurePass123!',
      });

      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].property).toBe('email');
    });

    it('should fail if email format is invalid', async () => {
      const dto = plainToClass(LoginDto, {
        email: 'not-an-email',
        password: 'SecurePass123!',
      });

      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].property).toBe('email');
      expect(errors[0].constraints).toHaveProperty('isEmail');
    });

    it('should transform email to lowercase and trim', async () => {
      const dto = plainToClass(LoginDto, {
        email: '  TEACHER@SCHOOL.EDU  ',
        password: 'SecurePass123!',
      });

      expect(dto.email).toBe('teacher@school.edu');
    });

    it('should accept various valid email formats', async () => {
      const validEmails = [
        'user@example.com',
        'user.name@example.com',
        'user+tag@example.co.uk',
        'user_name@sub.example.org',
      ];

      for (const email of validEmails) {
        const dto = plainToClass(LoginDto, {
          email,
          password: 'password',
        });

        const errors = await validate(dto);
        expect(errors.length).toBe(0);
      }
    });
  });

  describe('password', () => {
    it('should fail if password is missing', async () => {
      const dto = plainToClass(LoginDto, {
        email: 'teacher@school.edu',
      });

      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].property).toBe('password');
    });

    it('should fail if password is empty string', async () => {
      const dto = plainToClass(LoginDto, {
        email: 'teacher@school.edu',
        password: '',
      });

      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].property).toBe('password');
      expect(errors[0].constraints).toHaveProperty('minLength');
    });

    it('should accept any non-empty password', async () => {
      const dto = plainToClass(LoginDto, {
        email: 'teacher@school.edu',
        password: 'a',
      });

      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });

    it('should accept password with special characters', async () => {
      const dto = plainToClass(LoginDto, {
        email: 'teacher@school.edu',
        password: '!@#$%^&*()_+-=[]{}|;:",.<>?',
      });

      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });
  });

  it('should handle null values', async () => {
    const dto = plainToClass(LoginDto, {
      email: null,
      password: null,
    });

    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('should handle undefined values', async () => {
    const dto = plainToClass(LoginDto, {});

    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });
});
