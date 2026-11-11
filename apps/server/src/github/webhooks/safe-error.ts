/** What a log line may show of an error a webhook handler threw. */
export interface SafeError {
  readonly type: string;
  readonly code?: string;
  /** The stack's frames only, never its header (the message). */
  readonly stack?: string;
}

const NAME = /^[\w.:-]{1,64}$/;
const FRAME = /^\s+at /;

/**
 * The frames of `error.stack`: what follows its header, V8's `<name>: <message>`
 * (which may span several lines, of the payload). A stack that does not start
 * with that exact header was rewritten, or its message changed after it was
 * captured: its frames cannot be told from the message, it is dropped.
 */
const framesOf = (error: Error): string[] | undefined => {
  const stack = error.stack;
  // A class that sets its `name` after `super()` (Prisma's errors) has a stack captured as `Error: <message>`.
  const header = [Error.prototype.toString.call(error), `Error: ${error.message}`].find((candidate) => stack?.startsWith(`${candidate}\n`));
  if (stack === undefined || header === undefined) return undefined;
  const frames = stack.slice(header.length + 1).split('\n');
  return frames.every((line) => FRAME.test(line)) ? frames : undefined;
};

/**
 * An error of a webhook handler, without anything it might carry of the
 * payload (ADR 0003): its message and its properties are dropped, since a
 * handler may put an issue's body in either; its class name, a short code
 * (`AppError`'s, Prisma's `P2002`) and its stack frames are kept.
 */
export const safeError = (error: unknown): SafeError => {
  if (!(error instanceof Error)) return { type: typeof error };
  const code = (error as { code?: unknown }).code;
  const frames = framesOf(error);
  return {
    type: NAME.test(error.name) ? error.name : 'Error',
    ...(typeof code === 'string' && NAME.test(code) ? { code } : {}),
    ...(frames?.length ? { stack: frames.join('\n') } : {}),
  };
};
