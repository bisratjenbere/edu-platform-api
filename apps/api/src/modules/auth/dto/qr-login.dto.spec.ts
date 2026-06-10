import { validate } from 'class-validator';
import { plainToClass } from 'class-transformer';
import { QrLoginDto } from './qr-login.dto';

describe('QrLoginDto', () => {
  it('should pass validation with valid token', async () => {
    const dto = plainToClass(QrLoginDto, {
      token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdHVkZW50SWQiOiJzdHVkZW50LWlkIn0.signature',
    });

    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  describe('token', () => {
    it('should fail if token is missing', async () => {
      const dto = plainToClass(QrLoginDto, {});

      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].property).toBe('token');
    });

    it('should fail if token is empty string', async () => {
      const dto = plainToClass(QrLoginDto, {
        token: '',
      });

      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].property).toBe('token');
      expect(errors[0].constraints).toHaveProperty('minLength');
    });

    it('should fail if token is null', async () => {
      const dto = plainToClass(QrLoginDto, {
        token: null,
      });

      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].property).toBe('token');
    });

    it('should accept any non-empty string as token', async () => {
      const validTokens = [
        'simple-token',
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.signature',
        '12345',
        'token-with-dashes-and_underscores',
        'verylongtokenstring'.repeat(10),
      ];

      for (const token of validTokens) {
        const dto = plainToClass(QrLoginDto, { token });
        const errors = await validate(dto);
        expect(errors.length).toBe(0);
      }
    });

    it('should accept token with special characters', async () => {
      const dto = plainToClass(QrLoginDto, {
        token: 'token.with-special_chars+=/&',
      });

      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });

    it('should not fail with whitespace (no trimming defined)', async () => {
      const dto = plainToClass(QrLoginDto, {
        token: '  token-with-spaces  ',
      });

      const errors = await validate(dto);
      expect(errors.length).toBe(0);
      expect(dto.token).toBe('  token-with-spaces  ');
    });
  });

  it('should handle multiple validation errors', async () => {
    const dto = plainToClass(QrLoginDto, {
      token: '',
    });

    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe('token');
  });
});
