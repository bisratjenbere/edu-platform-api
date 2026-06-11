import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-oauth2';
import { ConfigService } from '@nestjs/config';
import { CleverApiService, CleverProfile } from './clever-api.service';

@Injectable()
export class CleverStrategy extends PassportStrategy(Strategy, 'clever') {
  constructor(
    private configService: ConfigService,
    private cleverApiService: CleverApiService,
  ) {
    const appUrl = configService.get<string>('APP_URL') || 'http://localhost:3001';
    
    super({
      authorizationURL: 'https://clever.com/oauth/authorize',
      tokenURL: 'https://clever.com/oauth/tokens',
      clientID: configService.get<string>('CLEVER_CLIENT_ID'),
      clientSecret: configService.get<string>('CLEVER_CLIENT_SECRET'),
      callbackURL: `${appUrl}/api/v1/auth/clever/callback`,
      scope: [
        'read:user_id',
        'read:sis',
        'read:students',
        'read:teachers',
        'read:sections',
      ],
      state: true, // CSRF protection
    });
  }

  async validate(accessToken: string): Promise<CleverProfile> {
    return this.cleverApiService.getProfile(accessToken);
  }
}
