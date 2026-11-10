import type { ErrorEnvelope } from '@crewdeck/contracts';
import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { ZodValidationException } from 'nestjs-zod';
import { ZodError } from 'zod';
import { AppError } from './app-error.js';
import { MESSAGES, type MessageCode } from './messages.js';

const envelope = (status: number, code: MessageCode, fields?: Record<string, string>): ErrorEnvelope =>
  fields ? { status, code, message: MESSAGES[code], fields } : { status, code, message: MESSAGES[code] };

/** Each issue's dotted path (`items.1.id`, `''` for the root) to its message; the first issue of a path wins. */
const issueFields = (error: unknown): Record<string, string> => {
  // A Map, not an object: a path named `constructor` or `toString` is not already there.
  const fields = new Map<string, string>();
  if (!(error instanceof ZodError)) return {};
  for (const issue of error.issues) {
    const path = issue.path.map(String).join('.');
    if (!fields.has(path)) fields.set(path, issue.message);
  }
  return Object.fromEntries(fields);
};

/** The client errors body-parser raises before any route (`http-errors`): exposed, with a 4xx status. */
const isBodyParserError = (error: unknown): error is Error & { status: number } => {
  const { expose, status } = error instanceof Error ? (error as Error & { expose?: unknown; status?: unknown }) : {};
  return expose === true && typeof status === 'number' && status >= 400 && status < 500;
};

/**
 * The global filter: every error leaves the server as the envelope of ADR
 * 0008, never as Nest's default body. Only the unexpected ones (500) are
 * logged, with their stack and never the request's body.
 */
@Catch()
export class ErrorFilter implements ExceptionFilter {
  constructor(
    private readonly adapterHost: HttpAdapterHost,
    @InjectPinoLogger(ErrorFilter.name) private readonly logger: PinoLogger,
  ) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const body = this.render(exception);
    this.adapterHost.httpAdapter.reply(host.switchToHttp().getResponse(), body, body.status);
  }

  private render(exception: unknown): ErrorEnvelope {
    if (exception instanceof AppError) return exception.toEnvelope();
    if (exception instanceof ZodValidationException) return envelope(400, 'validation.invalid', issueFields(exception.getZodError()));
    // Nest's own client errors (an unknown route, a body that is not JSON, a guard's refusal) and body-parser's (a body too large).
    const status = exception instanceof HttpException ? exception.getStatus() : isBodyParserError(exception) ? exception.status : 500;
    // No 403 (ADR 0008): what is not yours does not exist.
    if (status === 404 || status === 403) return envelope(404, 'http.not-found');
    if (status < 500) return envelope(status, 'http.bad-request');
    this.logger.error({ err: exception }, 'unexpected error');
    return envelope(500, 'server.internal');
  }
}
