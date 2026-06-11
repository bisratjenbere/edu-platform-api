import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private readonly client: Redis;

  constructor(private configService: ConfigService) {
    const redisUrl = this.configService.get<string>('REDIS_URL');
    
    if (!redisUrl) {
      throw new Error('REDIS_URL environment variable is not set');
    }

    this.client = new Redis(redisUrl, {
      maxRetriesPerRequest: 3,
      retryStrategy: (times) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
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

  /**
   * Set a key-value pair with optional expiry
   */
  async set(
    key: string,
    value: string,
    expiryMode?: 'EX' | 'PX',
    time?: number,
  ): Promise<'OK' | null> {
    try {
      if (expiryMode && time) {
        // Use uppercase mode and provide time
        if (expiryMode === 'EX') {
          return await this.client.set(key, value, 'EX', time);
        } else {
          return await this.client.set(key, value, 'PX', time);
        }
      }
      return await this.client.set(key, value);
    } catch (error: any) {
      this.logger.warn(`Redis SET error for key ${key}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get value by key
   */
  async get(key: string): Promise<string | null> {
    try {
      return await this.client.get(key);
    } catch (error: any) {
      this.logger.warn(`Redis GET error for key ${key}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Delete one or more keys
   */
  async del(...keys: string[]): Promise<number> {
    try {
      return await this.client.del(...keys);
    } catch (error: any) {
      this.logger.warn(`Redis DEL error for keys ${keys.join(', ')}: ${error.message}`);
      throw error;
    }
  }

  async onModuleDestroy() {
    await this.client.quit();
    this.logger.log('Redis connection closed');
  }
}
