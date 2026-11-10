import { z } from 'zod';

const zHttpUrl = z.url({ protocol: /^https?$/ });

/** The server's environment, parsed once at boot (`main.ts`). */
export const zEnv = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    /** Where this server runs: one image, two Compose projects (ADR 0009). */
    CREWDECK_ENV: z.enum(['production', 'staging', 'development', 'test']),
    /** The URL the Pilote opens; required outside development and test. */
    PUBLIC_URL: zHttpUrl.optional(),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    CREWDECK_COMMIT: z.string().min(1).default('dev'),
    /** The web build the server serves at `/`; unset in development, where Vite serves the page. */
    WEB_DIST_DIR: z.string().min(1).optional(),
    /** The Runner binaries of the same commit, `<dir>/<commit>/<os>-<arch>` (ADR 0004). */
    RUNNER_DIST_DIR: z.string().min(1).optional(),
    /** The GitHub App of this environment (CORE-3 makes it required). */
    GITHUB_APP_ID: z.string().min(1).optional(),
    /** Production only: the file the nightly backup writes its last success in (INFRA-8), read by `/api/health`. */
    BACKUP_STATUS_FILE: z.string().min(1).optional(),
    /** Staging only: production's values, which the staging guard refuses. */
    PROD_PUBLIC_URL: zHttpUrl.optional(),
    PROD_GITHUB_APP_ID: z.string().min(1).optional(),
  })
  .superRefine((env, context) => {
    const require = (key: keyof typeof env, why: string): void => {
      if (env[key] === undefined) context.addIssue({ code: 'custom', path: [key], message: `Required ${why}` });
    };
    if (env.CREWDECK_ENV === 'production' || env.CREWDECK_ENV === 'staging') {
      require('PUBLIC_URL', 'outside development and test');
    }
    if (env.CREWDECK_ENV === 'staging') {
      require('PROD_PUBLIC_URL', 'in staging');
      require('PROD_GITHUB_APP_ID', 'in staging');
    }
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

/**
 * Parses `source`; throws an `InvalidEnvError` listing every failed key. An
 * empty value (`KEY=` in an env file) counts as unset.
 */
export const parseEnv = (source: Record<string, string | undefined>): Env => {
  const values = Object.fromEntries(Object.entries(source).filter(([, value]) => value !== ''));
  const result = zEnv.safeParse(values);
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
