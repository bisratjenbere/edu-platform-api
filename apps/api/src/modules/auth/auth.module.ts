import { Module, Provider } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { QrController } from './qr.controller';
import { QrService } from './qr.service';
import { JwtStrategy } from './jwt.strategy';
import { GoogleStrategy } from './google.strategy';
import { GoogleOAuthService } from './google-oauth.service';
import { GoogleAuthGuard } from './google-auth.guard';
import { MailService } from './mail.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RolesGuard } from './roles.guard';
import { PrismaModule } from '../../prisma/prisma.module';

function isGoogleOAuthEnabled(): boolean {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  return Boolean(clientId && clientSecret);
}

function buildGoogleProviders(): Provider[] {
  return isGoogleOAuthEnabled() ? [GoogleStrategy] : [];
}

@Module({
  imports: [
    PrismaModule,
    ConfigModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        secret: configService.getOrThrow<string>('JWT_SECRET'),
        signOptions: { expiresIn: '15m' },
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [AuthController, QrController],
  providers: [
    AuthService,
    QrService,
    JwtStrategy,
    GoogleOAuthService,
    GoogleAuthGuard,
    MailService,
    JwtAuthGuard,
    RolesGuard,
    ...buildGoogleProviders(),
  ],
  exports: [AuthService, JwtAuthGuard, RolesGuard, JwtModule, MailService],
})
export class AuthModule {}
