import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Response } from 'express';

interface PrismaErrorMap {
  status: number;
  message: string;
}

const PRISMA_ERROR_MAP: Record<string, PrismaErrorMap> = {
  P2002: { status: HttpStatus.CONFLICT, message: 'Resource already exists' },
  P2025: { status: HttpStatus.NOT_FOUND, message: 'Resource not found' },
  P2003: { status: HttpStatus.BAD_REQUEST, message: 'Invalid reference' },
  P2014: { status: HttpStatus.BAD_REQUEST, message: 'Invalid relation' },
  P2016: { status: HttpStatus.BAD_REQUEST, message: 'Invalid query' },
};

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();
      if (typeof res === 'string') {
        message = res;
      } else if (typeof res === 'object' && res !== null) {
        const resObj = res as Record<string, unknown>;
        const msg = resObj['message'];
        message = Array.isArray(msg) ? msg[0] : (msg as string) ?? message;
      }
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      const mapped = PRISMA_ERROR_MAP[exception.code];
      if (mapped) {
        status = mapped.status;
        message = mapped.message;
      } else {
        this.logger.error(
          `Unhandled Prisma error [${exception.code}]`,
          exception.message,
        );
      }
    } else {
      // Unknown error — log but never expose internals
      this.logger.error('Unhandled exception', exception instanceof Error ? exception.stack : String(exception));
    }

    response.status(status).json({
      success: false,
      data: null,
      error: message,
    });
  }
}
