import { z } from 'zod';

/** The server's environment, parsed once at boot (`main.ts`). */
export const zEnv = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  CREWDECK_COMMIT: z.string().min(1).default('dev'),
});
export type Env = z.infer<typeof zEnv>;

export class InvalidEnvError extends Error {
  constructor(
    readonly keys: string[],
    details: string,
  ) {
    super(`Invalid environment: ${keys.join(', ')}\n${details}`);
    this.name = 'InvalidEnvError';
  }
}

/** Parses `source`; throws an `InvalidEnvError` listing every failed key. */
export const parseEnv = (source: Record<string, string | undefined>): Env => {
  const result = zEnv.safeParse(source);
  if (result.success) return result.data;
  const keys = [...new Set(result.error.issues.map((issue) => String(issue.path[0])))];
  const order = Object.keys(zEnv.shape);
  keys.sort((a, b) => order.indexOf(a) - order.indexOf(b));
  throw new InvalidEnvError(keys, z.prettifyError(result.error));
};

/** Parses the process's environment, or exits the process with the failed keys listed. */
export const loadEnv = (source: Record<string, string | undefined> = process.env): Env => {
  try {
    return parseEnv(source);
  } catch (error) {
    if (!(error instanceof InvalidEnvError)) throw error;
    console.error(error.message);
    return process.exit(1);
  }
};
