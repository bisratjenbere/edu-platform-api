import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super({
      log: ['error', 'warn'],
    });

    // Soft-delete middleware - automatically exclude deleted records
    this.$use(async (params, next) => {
      // Skip middleware for raw queries and operations that don't support where clause
      if (params.action === 'findUnique' || params.action === 'findFirst') {
        // Add deleted_at filter if not already present
        if (params.args.where && !params.args.where.deleted_at) {
          params.args.where.deleted_at = null;
        } else if (!params.args.where) {
          params.args.where = { deleted_at: null };
        }
      }

      if (params.action === 'findMany') {
        // Add deleted_at filter if not already present
        if (params.args) {
          if (params.args.where) {
            if (!params.args.where.deleted_at) {
              params.args.where.deleted_at = null;
            }
          } else {
            params.args.where = { deleted_at: null };
          }
        } else {
          params.args = { where: { deleted_at: null } };
        }
      }

      if (params.action === 'count') {
        // Add deleted_at filter if not already present
        if (params.args) {
          if (params.args.where) {
            if (!params.args.where.deleted_at) {
              params.args.where.deleted_at = null;
            }
          } else {
            params.args.where = { deleted_at: null };
          }
        } else {
          params.args = { where: { deleted_at: null } };
        }
      }

      // Convert delete to update with soft-delete
      if (params.action === 'delete') {
        params.action = 'update';
        params.args.data = { deleted_at: new Date() };
      }

      if (params.action === 'deleteMany') {
        params.action = 'updateMany';
        if (params.args.data) {
          params.args.data.deleted_at = new Date();
        } else {
          params.args.data = { deleted_at: new Date() };
        }
      }

      return next(params);
    });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  /**
   * Hard delete - use with extreme caution
   * This bypasses soft-delete middleware
   */
  async hardDelete(model: string, where: any): Promise<any> {
    return (this as any)[model].deleteMany({ where });
  }
}
