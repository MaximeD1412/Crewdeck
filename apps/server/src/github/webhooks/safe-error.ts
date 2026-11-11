/** What a log line may show of an error a webhook handler threw. */
export interface SafeError {
  readonly type: string;
  readonly code?: string;
  /** The stack's frames only: its first line is the message. */
  readonly stack?: string;
}

const NAME = /^[\w.:-]{1,64}$/;
const FRAME = /^\s+at /;

/**
 * An error of a webhook handler, without anything it might carry of the
 * payload (ADR 0003): its message and its properties are dropped, since a
 * handler may put an issue's body in either; its class name, a short code
 * (`AppError`'s, Prisma's `P2002`) and its stack frames are kept.
 */
export const safeError = (error: unknown): SafeError => {
  if (!(error instanceof Error)) return { type: typeof error };
  const code = (error as { code?: unknown }).code;
  const frames = error.stack?.split('\n').filter((line) => FRAME.test(line));
  return {
    type: NAME.test(error.name) ? error.name : 'Error',
    ...(typeof code === 'string' && NAME.test(code) ? { code } : {}),
    ...(frames?.length ? { stack: frames.join('\n') } : {}),
  };
};
