import { Injectable, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';

/**
 * Shared Redis client.
 *
 * Inject this instead of instantiating `new Redis(...)` directly in services.
 * Centralises connection management, TTL constants, and key-naming conventions
 * so they can be audited and changed in one place.
 *
 * Key scheme reference:
 *   refresh:{userId}          — hashed refresh token, TTL 7 days
 *   login_attempts:{ip}       — failed login counter, TTL 15 min (fixed window)
 *   used_qr:{sha256(token)}   — single-use QR marker, TTL 60 s
 *   user_active:{userId}      — cached is_active flag, TTL 60 s  (optional future use)
 */
@Injectable()
export class RedisService extends Redis implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);

  // TTL constants — define once, reference everywhere
  static readonly TTL = {
    REFRESH_TOKEN_SECONDS: 7 * 24 * 60 * 60,   // 7 days
    LOGIN_WINDOW_SECONDS: 900,                   // 15 minutes
    QR_TOKEN_SECONDS: 60,                        // 1 minute
  } as const;

  constructor(configService: ConfigService) {
    // getOrThrow ensures the app fails fast at startup when REDIS_URL is missing
    // rather than silently falling back to localhost in production.
    super(configService.getOrThrow<string>('REDIS_URL'));

    this.on('error', (err) => {
      this.logger.error('Redis connection error', err);
    });

    this.on('connect', () => {
      this.logger.log('Redis connected');
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.quit();
  }
}