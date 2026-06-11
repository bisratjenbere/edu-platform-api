import { Processor, Process } from '@nestjs/bull';
import { Job } from 'bull';
import { Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import {
  CleverApiService,
  CleverProfile,
  CleverSection,
} from './clever-api.service';
import {
  CleverSyncJobPayload,
  CleverSyncResult,
} from './clever-roster-sync.service';
import { Role } from '@prisma/client';

@Processor('clever-roster-sync')
export class CleverRosterSyncJob {
  private readonly logger = new Logger(CleverRosterSyncJob.name);

  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
    private cleverApi: CleverApiService,
  ) {}

  @Process('sync')
  async process(job: Job<CleverSyncJobPayload>): Promise<CleverSyncResult> {
    const { schoolId, cleverSchoolToken, cleverSchoolId, triggeredBy } = job.data;

    this.logger.log(
      `Starting Clever sync for school ${schoolId} (${triggeredBy})`,
    );

    const lockKey = `clever_sync_running:${schoolId}`;
    const result: CleverSyncResult = {
      schoolId,
      added: 0,
      updated: 0,
      deactivated: 0,
      errors: [],
      completedAt: '',
      status: 'SUCCESS',
    };

    try {
      // Step 1: Set Redis lock
      await this.redis.setex(lockKey, 30 * 60, '1'); // 30 minutes TTL

      // Step 2: Fetch ALL data from Clever API before processing
      this.logger.log('Fetching teachers from Clever...');
      const teachers = await this.cleverApi.getTeachersForSchool(
        cleverSchoolToken,
        cleverSchoolId,
      );

      this.logger.log('Fetching students from Clever...');
      const students = await this.cleverApi.getStudentsForSchool(
        cleverSchoolToken,
        cleverSchoolId,
      );

      this.logger.log('Fetching sections from Clever...');
      const sections = await this.cleverApi.getSectionsForSchool(
        cleverSchoolToken,
        cleverSchoolId,
      );

      this.logger.log(
        `Fetched ${teachers.length} teachers, ${students.length} students, ${sections.length} sections`,
      );

      // Safety guard: if empty response, abort without deactivating anyone
      if (teachers.length === 0 && students.length === 0) {
        this.logger.warn(
          'Clever API returned no teachers or students - aborting sync to prevent accidental deactivations',
        );
        result.status = 'FAILED';
        result.errors.push({
          cleverId: 'N/A',
          reason: 'Empty response from Clever API',
        });
        return result;
      }

      // Step 3: Process teachers
      for (const teacher of teachers) {
        try {
          const upserted = await this.upsertUser(
            teacher,
            schoolId,
            Role.TEACHER,
          );
          if (upserted.created) {
            result.added++;
          } else {
            result.updated++;
          }
        } catch (error) {
          this.logger.error(
            `Failed to upsert teacher ${teacher.id}`,
            error,
          );
          result.errors.push({
            cleverId: teacher.id,
            reason: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }

      // Step 4: Process students
      for (const student of students) {
        try {
          const upserted = await this.upsertUser(
            student,
            schoolId,
            Role.STUDENT,
          );
          if (upserted.created) {
            result.added++;
          } else {
            result.updated++;
          }
        } catch (error) {
          this.logger.error(
            `Failed to upsert student ${student.id}`,
            error,
          );
          result.errors.push({
            cleverId: student.id,
            reason: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }

      // Step 5: Deactivation - only runs after steps 3 and 4 complete
      const allCleverIds = new Set([
        ...teachers.map((t) => t.id),
        ...students.map((s) => s.id),
      ]);

      // Find users in EduFlow with clever_id NOT in the fetched set
      const usersToDeactivate = await this.prisma.user.findMany({
        where: {
          school_id: schoolId,
          clever_id: { not: null },
          is_active: true,
          deleted_at: null,
        },
      });

      for (const user of usersToDeactivate) {
        if (user.clever_id && !allCleverIds.has(user.clever_id)) {
          try {
            await this.prisma.user.update({
              where: { id: user.id },
              data: { is_active: false },
            });
            result.deactivated++;
            this.logger.log(
              `Deactivated user ${user.id} (clever_id: ${user.clever_id})`,
            );
          } catch (error) {
            this.logger.error(
              `Failed to deactivate user ${user.id}`,
              error,
            );
            result.errors.push({
              cleverId: user.clever_id || 'unknown',
              reason: error instanceof Error ? error.message : 'Unknown error',
            });
          }
        }
      }

      // Set status based on errors
      if (result.errors.length > 0) {
        result.status = 'PARTIAL';
      }

      result.completedAt = new Date().toISOString();

      // Step 6: Store result in Redis
      const resultKey = `clever_sync_last:${schoolId}`;
      await this.redis.set(resultKey, JSON.stringify(result));

      // Step 7: Log AuditLog
      await this.prisma.auditLog.create({
        data: {
          actor_id: 'system',
          action: 'CLEVER_SYNC_COMPLETE',
          resource_type: 'School',
          resource_id: schoolId,
          metadata: {
            added: result.added,
            updated: result.updated,
            deactivated: result.deactivated,
            errors: result.errors.length,
            triggeredBy,
          },
        },
      });

      this.logger.log(
        `Clever sync completed for school ${schoolId}: +${result.added} ~${result.updated} -${result.deactivated} errors:${result.errors.length}`,
      );

      return result;
    } catch (error) {
      this.logger.error(`Clever sync failed for school ${schoolId}`, error);
      result.status = 'FAILED';
      result.completedAt = new Date().toISOString();
      result.errors.push({
        cleverId: 'N/A',
        reason: error instanceof Error ? error.message : 'Unknown error',
      });

      // Store failed result
      const resultKey = `clever_sync_last:${schoolId}`;
      await this.redis.set(resultKey, JSON.stringify(result));

      throw error; // Let BullMQ handle retries
    } finally {
      // Step 8: Always release lock
      await this.redis.del(lockKey);
      this.logger.log(`Released lock for school ${schoolId}`);
    }
  }

  /**
   * Upsert a user from Clever profile
   */
  private async upsertUser(
    profile: CleverProfile,
    schoolId: string,
    role: Role,
  ): Promise<{ created: boolean }> {
    // Look up by clever_id first
    let user = await this.prisma.user.findFirst({
      where: {
        clever_id: profile.id,
        deleted_at: null,
      },
    });

    // Fall back to email lookup
    if (!user && profile.email) {
      user = await this.prisma.user.findFirst({
        where: {
          email: profile.email,
          deleted_at: null,
        },
      });
    }

    // Fall back to student_number lookup (students only)
    if (!user && profile.student_number) {
      user = await this.prisma.user.findFirst({
        where: {
          email: profile.student_number, // Using email field for student_number
          deleted_at: null,
        },
      });
    }

    if (user) {
      // Update existing user
      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          clever_id: profile.id,
          first_name: profile.name.first,
          last_name: profile.name.last,
          email: profile.email,
          is_active: true,
        },
      });
      return { created: false };
    } else {
      // Create new user
      await this.prisma.user.create({
        data: {
          clever_id: profile.id,
          email: profile.email,
          first_name: profile.name.first,
          last_name: profile.name.last,
          role,
          school_id: schoolId,
          is_active: true,
        },
      });
      return { created: true };
    }
  }
}
