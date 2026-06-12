/**
 * UploadsMetricsInterceptor — Gap 7
 *
 * Emits structured log lines for every request that passes through the
 * uploads controller. Each line includes:
 *   • HTTP method + path
 *   • response status code
 *   • duration in milliseconds
 *   • userId (from JWT `sub` claim, if present)
 *
 * This keeps the service layer free of HTTP concerns while giving us
 * queryable, timestamped metrics in CloudWatch Logs Insights / Datadog.
 *
 * When the project adds OpenTelemetry (or another metrics backend), swap
 * the logger calls here for counter/histogram increments without touching
 * any other file.
 */
import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, tap, catchError, throwError } from 'rxjs';
import { Request, Response } from 'express';
import { JwtPayload } from '../uploads.service';

@Injectable()
export class UploadsMetricsInterceptor implements NestInterceptor {
  private readonly logger = new Logger('UploadsMetrics');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    const start = Date.now();

    const method = req.method;
    const path = req.path;
    const userId = (req.user as JwtPayload | undefined)?.sub ?? 'unauthenticated';

    return next.handle().pipe(
      tap(() => {
        const ms = Date.now() - start;
        const status = res.statusCode;
        this.logger.log(
          `${method} ${path} ${status} ${ms}ms userId=${userId}`,
        );
      }),
      catchError((err: unknown) => {
        const ms = Date.now() - start;
        const status =
          (err as { status?: number })?.status ?? 500;
        this.logger.warn(
          `${method} ${path} ${status} ${ms}ms userId=${userId} error=${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        return throwError(() => err);
      }),
    );
  }
}