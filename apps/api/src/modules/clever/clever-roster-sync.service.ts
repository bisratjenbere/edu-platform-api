import {
  Injectable,
  ConflictException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue, Job } from 'bull';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';

export interface CleverSyncJobPayload {
  schoolId: string;
  cleverSchoolToken: string;
  cleverSchoolId: string;
  triggeredBy: 'CRON' | 'MANUAL';
  triggeredAt: string;
}

export interface CleverSyncResult {
  schoolId: string;
  added: number;
  updated: number;
  deactivated: number;
  errors: Array<{ cleverId: string; reason: string }>;
  completedAt: string;
  status: 'SUCCESS' | 'PARTIAL' | 'FAILED';
}

@Injectable()
export class CleverRosterSyncService {
  private readonly logger = new Logger(CleverRosterSyncService.name);

  constructor(
    @InjectQueue('clever-roster-sync') private syncQueue: Queue,
    private prisma: PrismaService,
    private redis: RedisService,
  ) {}

  /**
   * Enqueue a sync job for a school
   */
  async enqueueSync(
    schoolId: string,
    triggeredBy: 'CRON' | 'MANUAL',
  ): Promise<{ jobId: string; status: string }> {
    // Check if a sync is already running for this school
    const lockKey = `clever_sync_running:${schoolId}`;
    const isRunning = await this.redis.get(lockKey);

    if (isRunning) {
      throw new ConflictException('A sync is already in progress for this school');
    }

    // Fetch school details
    const school = await this.prisma.school.findUnique({
      where: { id: schoolId, deleted_at: null },
    });

    if (!school) {
      throw new NotFoundException('School not found');
    }

    if (!school.clever_enabled) {
      throw new ConflictException('Clever is not enabled for this school');
    }

    if (!school.clever_district_token) {
      throw new ConflictException('Clever district token not configured for this school');
    }

    // For now, we'll use the school ID as the Clever school ID
    // In production, this should be stored separately in the School model
    const cleverSchoolId = schoolId; // TODO: Add clever_school_id to School model

    const payload: CleverSyncJobPayload = {
      schoolId,
      cleverSchoolToken: school.clever_district_token,
      cleverSchoolId,
      triggeredBy,
      triggeredAt: new Date().toISOString(),
    };

    const job = await this.syncQueue.add('sync', payload, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: true,
      removeOnFail: false,
    });

    this.logger.log(
      `Enqueued Clever sync job ${job.id} for school ${schoolId} (${triggeredBy})`,
    );

    return {
      jobId: String(job.id),
      status: 'QUEUED',
    };
  }

  /**
   * Get the status of a sync job
   */
  async getSyncStatus(
    jobId: string,
  ): Promise<{ jobId: string; status: string; result?: CleverSyncResult }> {
    const job = await this.syncQueue.getJob(jobId);

    if (!job) {
      throw new NotFoundException('Sync job not found');
    }

    const state = await job.getState();
    const result = state === 'completed' ? (job.returnvalue as CleverSyncResult) : undefined;

    return {
      jobId,
      status: state.toUpperCase(),
      result,
    };
  }

  /**
   * Get the last sync summary for a school
   */
  async getLastSyncSummary(schoolId: string): Promise<CleverSyncResult | null> {
    const key = `clever_sync_last:${schoolId}`;
    const data = await this.redis.get(key);

    if (!data) {
      return null;
    }

    try {
      return JSON.parse(data) as CleverSyncResult;
    } catch (error) {
      this.logger.error(`Failed to parse last sync result for school ${schoolId}`, error);
      return null;
    }
  }
}
