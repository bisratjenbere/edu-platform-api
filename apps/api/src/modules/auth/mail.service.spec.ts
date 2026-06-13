import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { MailService } from './mail.service';

describe('MailService', () => {
  let service: MailService;

  const mockConfigService = {
    get: jest.fn((key: string) => {
      const config: Record<string, string> = {
        APP_NAME: 'EduFlow',
        PASSWORD_RESET_TTL_SECONDS: '900',
      };
      return config[key];
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MailService,
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<MailService>(MailService);
    service.onModuleInit();
  });

  it('logs email when SMTP is not configured', async () => {
    const debugSpy = jest.spyOn((service as any).logger, 'debug');

    await service.sendPasswordResetEmail('teacher@school.edu', 'ABC123');

    expect(debugSpy).toHaveBeenCalled();
    expect(service.isConfigured()).toBe(false);
  });
});
