import { validate } from 'class-validator';
import { plainToClass } from 'class-transformer';
import { RegisterDto } from './register.dto';

describe('RegisterDto', () => {
  it('should pass validation with valid data', async () => {
    const dto = plainToClass(RegisterDto, {
      email: 'teacher@school.edu',
      password: 'SecurePass123!',
      firstName: 'Jane',
      lastName: 'Doe',
    });

    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  describe('email', () => {
    it('should fail if email is missing', async () => {
      const dto = plainToClass(RegisterDto, {
        password: 'SecurePass123!',
        firstName: 'Jane',
        lastName: 'Doe',
      });

      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].property).toBe('email');
    });

    it('should fail if email format is invalid', async () => {
      const dto = plainToClass(RegisterDto, {
        email: 'not-an-email',
        password: 'SecurePass123!',
        firstName: 'Jane',
        lastName: 'Doe',
      });

      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].property).toBe('email');
      expect(errors[0].constraints).toHaveProperty('isEmail');
    });

    it('should transform email to lowercase and trim', async () => {
      const dto = plainToClass(RegisterDto, {
        email: '  TEACHER@SCHOOL.EDU  ',
        password: 'SecurePass123!',
        firstName: 'Jane',
        lastName: 'Doe',
      });

      expect(dto.email).toBe('teacher@school.edu');
    });
  });

  describe('password', () => {
    it('should fail if password is missing', async () => {
      const dto = plainToClass(RegisterDto, {
        email: 'teacher@school.edu',
        firstName: 'Jane',
        lastName: 'Doe',
      });

      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].property).toBe('password');
    });

    it('should fail if password is less than 8 characters', async () => {
      const dto = plainToClass(RegisterDto, {
        email: 'teacher@school.edu',
        password: 'Short1!',
        firstName: 'Jane',
        lastName: 'Doe',
      });

      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].property).toBe('password');
      expect(errors[0].constraints).toHaveProperty('minLength');
    });

    it('should fail if password exceeds 100 characters', async () => {
      const dto = plainToClass(RegisterDto, {
        email: 'teacher@school.edu',
        password: 'a'.repeat(101),
        firstName: 'Jane',
        lastName: 'Doe',
      });

      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].property).toBe('password');
      expect(errors[0].constraints).toHaveProperty('maxLength');
    });

    it('should pass with exactly 8 characters', async () => {
      const dto = plainToClass(RegisterDto, {
        email: 'teacher@school.edu',
        password: 'Pass123!',
        firstName: 'Jane',
        lastName: 'Doe',
      });

      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });
  });

  describe('firstName', () => {
    it('should fail if firstName is missing', async () => {
      const dto = plainToClass(RegisterDto, {
        email: 'teacher@school.edu',
        password: 'SecurePass123!',
        lastName: 'Doe',
      });

      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].property).toBe('firstName');
    });

    it('should fail if firstName is empty string', async () => {
      const dto = plainToClass(RegisterDto, {
        email: 'teacher@school.edu',
        password: 'SecurePass123!',
        firstName: '',
        lastName: 'Doe',
      });

      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].property).toBe('firstName');
    });

    it('should sanitize HTML from firstName', async () => {
      const dto = plainToClass(RegisterDto, {
        email: 'teacher@school.edu',
        password: 'SecurePass123!',
        firstName: '<script>alert("xss")</script>Jane',
        lastName: 'Doe',
      });

      expect(dto.firstName).toBe('Jane');
    });

    it('should trim whitespace from firstName', async () => {
      const dto = plainToClass(RegisterDto, {
        email: 'teacher@school.edu',
        password: 'SecurePass123!',
        firstName: '  Jane  ',
        lastName: 'Doe',
      });

      expect(dto.firstName).toBe('Jane');
    });

    it('should fail if firstName exceeds 100 characters', async () => {
      const dto = plainToClass(RegisterDto, {
        email: 'teacher@school.edu',
        password: 'SecurePass123!',
        firstName: 'a'.repeat(101),
        lastName: 'Doe',
      });

      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].property).toBe('firstName');
      expect(errors[0].constraints).toHaveProperty('maxLength');
    });
  });

  describe('lastName', () => {
    it('should fail if lastName is missing', async () => {
      const dto = plainToClass(RegisterDto, {
        email: 'teacher@school.edu',
        password: 'SecurePass123!',
        firstName: 'Jane',
      });

      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].property).toBe('lastName');
    });

    it('should fail if lastName is empty string', async () => {
      const dto = plainToClass(RegisterDto, {
        email: 'teacher@school.edu',
        password: 'SecurePass123!',
        firstName: 'Jane',
        lastName: '',
      });

      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].property).toBe('lastName');
    });

    it('should sanitize HTML from lastName', async () => {
      const dto = plainToClass(RegisterDto, {
        email: 'teacher@school.edu',
        password: 'SecurePass123!',
        firstName: 'Jane',
        lastName: '<img src=x onerror=alert(1)>Doe',
      });

      expect(dto.lastName).toBe('Doe');
    });

    it('should trim whitespace from lastName', async () => {
      const dto = plainToClass(RegisterDto, {
        email: 'teacher@school.edu',
        password: 'SecurePass123!',
        firstName: 'Jane',
        lastName: '  Doe  ',
      });

      expect(dto.lastName).toBe('Doe');
    });

    it('should fail if lastName exceeds 100 characters', async () => {
      const dto = plainToClass(RegisterDto, {
        email: 'teacher@school.edu',
        password: 'SecurePass123!',
        firstName: 'Jane',
        lastName: 'a'.repeat(101),
      });

      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].property).toBe('lastName');
      expect(errors[0].constraints).toHaveProperty('maxLength');
    });
  });
});
