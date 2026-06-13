import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { GoogleOAuthService } from './google-oauth.service';

describe('GoogleOAuthService', () => {
  let service: GoogleOAuthService;

  const mockConfigService = {
    get: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GoogleOAuthService,
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<GoogleOAuthService>(GoogleOAuthService);
    jest.clearAllMocks();
  });

  it('returns false when Google credentials are missing', () => {
    mockConfigService.get.mockImplementation((key: string) => {
      if (key === 'GOOGLE_CLIENT_ID') return '';
      if (key === 'GOOGLE_CLIENT_SECRET') return 'secret';
      return null;
    });

    expect(service.isEnabled()).toBe(false);
  });

  it('returns true when Google credentials are present', () => {
    mockConfigService.get.mockImplementation((key: string) => {
      if (key === 'GOOGLE_CLIENT_ID') return 'client-id';
      if (key === 'GOOGLE_CLIENT_SECRET') return 'client-secret';
      return null;
    });

    expect(service.isEnabled()).toBe(true);
  });
});
