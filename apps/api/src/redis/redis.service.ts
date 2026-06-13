import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private readonly client: Redis;

  /** TTL constants — define once, reference everywhere */
  static readonly TTL = {
    REFRESH_TOKEN_SECONDS: 7 * 24 * 60 * 60,
    LOGIN_WINDOW_SECONDS: 900,
    QR_TOKEN_SECONDS: 60,
    OAUTH_CODE_SECONDS: 60,
    PASSWORD_RESET_SECONDS: 900,
  } as const;

  constructor(private configService: ConfigService) {
    const redisUrl = this.configService.getOrThrow<string>('REDIS_URL');

    this.client = new Redis(redisUrl, {
      maxRetriesPerRequest: 3,
      retryStrategy: (times) => Math.min(times * 50, 2000),
    });

    this.client.on('error', (error) => {
      this.logger.warn(`Redis connection error: ${error.message}`);
    });

    this.client.on('connect', () => {
      this.logger.log('Redis connected successfully');
    });
  }

  getClient(): Redis {
    return this.client;
  }

  async set(
    key: string,
    value: string,
    expiryMode?: 'EX' | 'PX',
    time?: number,
  ): Promise<'OK' | null> {
    try {
      if (expiryMode && time) {
        if (expiryMode === 'EX') {
          return await this.client.set(key, value, 'EX', time);
        }
        return await this.client.set(key, value, 'PX', time);
      }
      return await this.client.set(key, value);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(`Redis SET error for key ${key}: ${message}`);
      throw error;
    }
  }

  /**
   * Atomic set-if-not-exists with expiry. Returns true when the key was set.
   */
  async setNx(key: string, value: string, ttlSeconds: number): Promise<boolean> {
    try {
      const result = await this.client.set(key, value, 'EX', ttlSeconds, 'NX');
      return result === 'OK';
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(`Redis SET NX error for key ${key}: ${message}`);
      throw error;
    }
  }

  async get(key: string): Promise<string | null> {
    try {
      return await this.client.get(key);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(`Redis GET error for key ${key}: ${message}`);
      throw error;
    }
  }

  async del(...keys: string[]): Promise<number> {
    try {
      return await this.client.del(...keys);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(`Redis DEL error for keys ${keys.join(', ')}: ${message}`);
      throw error;
    }
  }

  async setex(key: string, seconds: number, value: string): Promise<'OK'> {
    try {
      return await this.client.setex(key, seconds, value);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(`Redis SETEX error for key ${key}: ${message}`);
      throw error;
    }
  }

  async incr(key: string): Promise<number> {
    try {
      return await this.client.incr(key);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(`Redis INCR error for key ${key}: ${message}`);
      throw error;
    }
  }

  async expire(key: string, seconds: number): Promise<number> {
    try {
      return await this.client.expire(key, seconds);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(`Redis EXPIRE error for key ${key}: ${message}`);
      throw error;
    }
  }

  async onModuleDestroy() {
    await this.client.quit();
    this.logger.log('Redis connection closed');
  }
}
