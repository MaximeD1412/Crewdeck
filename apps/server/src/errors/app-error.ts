import type { ErrorEnvelope } from '@crewdeck/contracts';

/**
 * The statuses a module may answer with (ADR 0008); no 403: another Pilote's
 * resource is a 404. 500 only for a system we depend on that fails, with its
 * own message (`github.unavailable`): ADR 0008 has no 502. 429 for a route
 * that counts its attempts (`runner.link-rate-limited`, ADR 0003).
 */
export type AppErrorStatus = 400 | 401 | 404 | 409 | 422 | 429 | 500;

/**
 * An error the client caused, or a dependency's failure the page explains, rendered as is in the envelope by the global
 * filter. `code` is `<module>.<case>` with its French `message` in
 * `messages.ts`; `fields` maps a field's dotted path to its message.
 */
export class AppError extends Error {
  constructor(
    readonly status: AppErrorStatus,
    readonly code: string,
    message: string,
    readonly fields?: Record<string, string>,
  ) {
    super(message);
    this.name = 'AppError';
  }

  toEnvelope(): ErrorEnvelope {
    const envelope: ErrorEnvelope = { status: this.status, code: this.code, message: this.message };
    if (this.fields) envelope.fields = this.fields;
    return envelope;
  }
}

/** 404: absent, or another Pilote's. */
export const notFound = (code: string, message: string): AppError => new AppError(404, code, message);

/** 409: a stale state (a command older than the resource's last change). */
export const conflict = (code: string, message: string): AppError => new AppError(409, code, message);

/** 422: a business rule. */
export const unprocessable = (code: string, message: string, fields?: Record<string, string>): AppError =>
  new AppError(422, code, message, fields);
