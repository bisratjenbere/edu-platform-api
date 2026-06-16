import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { PrismaService } from '../../prisma/prisma.service';
import { toZonedTime, fromZonedTime } from 'date-fns-tz';
import { addDays, setHours, setMinutes, setSeconds, setMilliseconds, isAfter } from 'date-fns';

@Injectable()
export class CleverSchedulerService implements OnModuleInit {
  private readonly logger = new Logger(CleverSchedulerService.name);

  constructor(
    private prisma: PrismaService,
    @InjectQueue('clever-roster-sync') private syncQueue: Queue,
  ) {}

  async onModuleInit() {
    // Schedule all enabled schools at app startup
    await this.scheduleAllSchools();
  }

  /**
   * Schedule sync jobs for all schools with clever_enabled=true
   */
  async scheduleAllSchools(): Promise<void> {
    const schools = await this.prisma.school.findMany({
      where: {
        clever_enabled: true,
        deleted_at: null,
      },
      select: {
        id: true,
        name: true,
        timezone: true,
        clever_district_token: true,
      },
    });

    this.logger.log(
      `Scheduling Clever sync for ${schools.length} schools at bootstrap`,
    );

    for (const school of schools) {
      if (!school.clever_district_token) {
        this.logger.warn(
          `School ${school.id} (${school.name}) has clever_enabled=true but no district token`,
        );
        continue;
      }

      try {
        await this.scheduleNextSync(
          school.id,
          school.timezone,
          school.clever_district_token,
        );
      } catch (error) {
        this.logger.error(
          `Failed to schedule sync for school ${school.id}`,
          error,
        );
      }
    }
  }

  /**
   * Schedule the next 2 AM sync for a school
   * Uses date-fns-tz for timezone-aware calculations
   */
  async scheduleNextSync(
    schoolId: string,
    timezone: string,
    cleverDistrictToken: string,
  ): Promise<void> {
    try {
      // Get current time in school's timezone
      const nowUtc = new Date();
      const nowInSchoolTz = toZonedTime(nowUtc, timezone);

      // Set target to 2 AM today in school's timezone
      let targetInSchoolTz = setHours(nowInSchoolTz, 2);
      targetInSchoolTz = setMinutes(targetInSchoolTz, 0);
      targetInSchoolTz = setSeconds(targetInSchoolTz, 0);
      targetInSchoolTz = setMilliseconds(targetInSchoolTz, 0);

      // If 2 AM has already passed today, schedule for tomorrow
      if (isAfter(nowInSchoolTz, targetInSchoolTz)) {
        targetInSchoolTz = addDays(targetInSchoolTz, 1);
      }

      // Convert target time back to UTC
      const targetUtc = fromZonedTime(targetInSchoolTz, timezone);
      const delayMs = targetUtc.getTime() - nowUtc.getTime();

      // Enqueue delayed job
      await this.syncQueue.add(
        'sync',
        {
          schoolId,
          cleverSchoolToken: cleverDistrictToken,
          cleverSchoolId: schoolId, // This should be the Clever school ID from their API
          triggeredBy: 'cron',
        },
        {
          delay: delayMs,
          jobId: `clever-sync-${schoolId}-${targetUtc.toISOString()}`,
          removeOnComplete: true,
          removeOnFail: false,
        },
      );

      this.logger.log(
        `Scheduled Clever sync for school ${schoolId} at ${targetInSchoolTz.toISOString()} (${timezone}) — delay: ${Math.round(delayMs / 1000 / 60)} minutes`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to schedule sync for school ${schoolId}`,
        error,
      );
      throw error;
    }
  }

  /**
   * Reschedule after a successful sync
   * Called by the job processor after completion
   */
  async rescheduleAfterSync(
    schoolId: string,
    timezone: string,
    cleverDistrictToken: string,
  ): Promise<void> {
    this.logger.log(`Re-scheduling next sync for school ${schoolId}`);
    await this.scheduleNextSync(schoolId, timezone, cleverDistrictToken);
  }
}
