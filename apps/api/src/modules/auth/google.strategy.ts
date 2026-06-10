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
      clientID: configService.get<string>('GOOGLE_CLIENT_ID'),
      clientSecret: configService.get<string>('GOOGLE_CLIENT_SECRET'),
      callbackURL: configService.get<string>('GOOGLE_CALLBACK_URL') || 'http://localhost:3001/api/v1/auth/google/callback',
      scope: ['email', 'profile'],
    });
  }

  async validate(
    accessToken: string,
    refreshToken: string,
    profile: Profile,
    done: VerifyCallback,
  ): Promise<any> {
    try {
      // Extract email from profile
      const email = profile.emails?.[0]?.value;
      
      if (!email) {
        return done(new Error('No email found in Google profile'), false);
      }

      // Validate and upsert user via AuthService
      const user = await this.authService.validateGoogleUser({
        googleId: profile.id,
        email,
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
