import type { Params } from 'nestjs-pino';
import type { DestinationStream } from 'pino';
import type { Env } from '../config/env.js';
import { REDACT_CENSOR, REDACT_PATHS } from './redact.js';

/** Where the logs go: stdout by default, a stream (a test capturing them), or nowhere. */
export type LogDestination = DestinationStream | false | undefined;

/** A request's URL without its query string: the query is logged apart, redacted (`req.query.code`). */
const withoutQuery = (url: string): string => url.split('?', 1)[0] ?? url;

/**
 * The app's logger (`nestjs-pino`): JSON lines, pretty in development on
 * stdout. The HTTP auto-logging writes a request's method, path, query,
 * headers and status, never its body.
 */
export const loggerParams = (env: Env, destination: LogDestination): Params => {
  const pretty = env.NODE_ENV === 'development' && destination === undefined;
  const options = {
    level: destination === false ? 'silent' : 'info',
    redact: { paths: [...REDACT_PATHS], censor: REDACT_CENSOR },
    serializers: {
      req: (req: { url: string }) => ({ ...req, url: withoutQuery(req.url) }),
    },
    ...(pretty ? { transport: { target: 'pino-pretty', options: { singleLine: true } } } : {}),
  };
  return { pinoHttp: destination ? [options, destination] : options };
};
