import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, VerifyCallback, Profile } from 'passport-google-oauth20';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(
    private configService: ConfigService,
    private authService: AuthService,
  ) {
    super({
      clientID: configService.getOrThrow<string>('GOOGLE_CLIENT_ID'),
      clientSecret: configService.getOrThrow<string>('GOOGLE_CLIENT_SECRET'),
      callbackURL:
        configService.get<string>('GOOGLE_CALLBACK_URL') ||
        'http://localhost:3001/api/v1/auth/google/callback',
      scope: ['email', 'profile'],
    });
  }

  async validate(
    accessToken: string,
    refreshToken: string,
    profile: Profile,
    done: VerifyCallback,
  ): Promise<void> {
    try {
      const emailEntry = profile.emails?.[0];

      if (!emailEntry?.value || !emailEntry.verified) {
        return done(new Error('Email not verified by Google'), false);
      }

      const user = await this.authService.validateGoogleUser({
        googleId: profile.id,
        email: emailEntry.value,
        firstName: profile.name?.givenName,
        lastName: profile.name?.familyName,
        profilePhoto: profile.photos?.[0]?.value,
      });

      done(null, user);
    } catch (error) {
      done(error, false);
    }
  }
}
