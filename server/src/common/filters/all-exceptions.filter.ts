import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import type { AppConfig } from '../../config/configuration';
import { Prisma } from '../../generated/prisma/client.js';

/**
 * Every error the app can throw ends up as the same JSON shape:
 * `{ statusCode, message }`. Two things this buys us specifically:
 *
 * 1. The spec's rule that an unauthorized call gets "a proper 403 Forbidden"
 *    (not a stack trace, not an inconsistent shape depending on which layer
 *    threw) applies to every route without each controller re-implementing it.
 * 2. In production, an unexpected error never leaks its message or stack to
 *    the client — it logs server-side and returns a generic 500.
 *
 * Prisma error codes are translated to HTTP status here so a unique-
 * constraint violation (P2002 — e.g. registering an email that's still
 * ACTIVE) reads as a 409, not an unhandled 500.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  constructor(private readonly config: ConfigService<AppConfig, true>) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const isProduction =
      this.config.getOrThrow('nodeEnv', { infer: true }) === 'production';

    const { statusCode, message, extra } = this.resolve(exception);
    // statusCode is a plain HTTP status number (from exception.getStatus() or
    // our own HttpStatus constants) — comparing it against the enum's
    // numeric value is the standard, safe idiom here.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-enum-comparison
    const isServerError = statusCode >= HttpStatus.INTERNAL_SERVER_ERROR;

    if (isServerError) {
      this.logger.error(
        exception instanceof Error ? exception.stack : exception,
      );
    }

    response.status(statusCode).json({
      statusCode,
      message:
        isServerError && isProduction ? 'Internal server error' : message,
      // Extra fields an exception attached beyond {message} — e.g.
      // ForbiddenException({ message, reason }) in AuthService.login, whose
      // `reason: 'PENDING_APPROVAL'` lets the frontend show a specific
      // message instead of a generic "forbidden" (story doc §4.2). Omitted
      // in production for a 5xx, same as the message itself.
      ...(isServerError && isProduction ? {} : extra),
    });
  }

  private resolve(exception: unknown): {
    statusCode: number;
    message: string;
    extra?: Record<string, unknown>;
  } {
    if (exception instanceof HttpException) {
      const body = exception.getResponse();
      const message =
        typeof body === 'string'
          ? body
          : ((body as { message?: string | string[] }).message ??
            exception.message);

      const extra =
        typeof body === 'object' && body !== null
          ? Object.fromEntries(
              Object.entries(body as Record<string, unknown>).filter(
                ([key]) => key !== 'message' && key !== 'statusCode',
              ),
            )
          : undefined;

      return {
        statusCode: exception.getStatus(),
        message: Array.isArray(message) ? message.join(', ') : message,
        extra,
      };
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      switch (exception.code) {
        case 'P2002':
          return {
            statusCode: HttpStatus.CONFLICT,
            message: 'A record with this value already exists',
          };
        case 'P2025':
          return { statusCode: HttpStatus.NOT_FOUND, message: 'Not found' };
        default:
          return {
            statusCode: HttpStatus.BAD_REQUEST,
            message: 'Invalid request',
          };
      }
    }

    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: exception instanceof Error ? exception.message : 'Unknown error',
    };
  }
}
