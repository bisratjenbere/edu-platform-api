import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { UploadsController } from './uploads.controller';
import { UploadsService } from './uploads.service';
import { UploadsMetricsInterceptor } from './interceptors/uploads-metrics.interceptor';

@Module({
  imports: [ConfigModule],
  controllers: [UploadsController],
  providers: [
    UploadsService,
    // Gap 7 — scoped to this module via APP_INTERCEPTOR registration here.
    // Using provide: APP_INTERCEPTOR would apply it globally; registering it
    // as a plain provider and binding it in the controller with @UseInterceptors
    // keeps it scoped to uploads only.
    {
      provide: APP_INTERCEPTOR,
      useClass: UploadsMetricsInterceptor,
    },
  ],
  exports: [UploadsService],
})
export class UploadsModule {}