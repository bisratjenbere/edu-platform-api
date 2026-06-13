import {
  ExecutionContext,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Observable } from 'rxjs';
import { GoogleOAuthService } from './google-oauth.service';

@Injectable()
export class GoogleAuthGuard extends AuthGuard('google') {
  constructor(private readonly googleOAuth: GoogleOAuthService) {
    super();
  }

  canActivate(
    context: ExecutionContext,
  ): boolean | Promise<boolean> | Observable<boolean> {
    if (!this.googleOAuth.isEnabled()) {
      throw new ServiceUnavailableException(
        'Google OAuth is not configured on this server',
      );
    }

    return super.canActivate(context);
  }
}
