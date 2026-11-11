import { z } from 'zod';

const zHttpUrl = z.url({ protocol: /^https?$/ });

const PEM = /^-----BEGIN [A-Z ]*PRIVATE KEY-----\n[\s\S]+\n-----END [A-Z ]*PRIVATE KEY-----\n?$/;

/**
 * The App's private key: the PEM itself, the PEM on one line with its
 * newlines escaped (`\n`), or the PEM in base64 (`base64 -w0 key.pem`, what
 * the server's `.env` holds). Always read back as the PEM.
 */
const zPrivateKey = z
  .string()
  .transform((value) => {
    const text = value.trim();
    const pem = text.startsWith('-----BEGIN') ? text.replaceAll('\\n', '\n') : Buffer.from(text, 'base64').toString('utf8');
    return `${pem.trim()}\n`;
  })
  .refine((pem) => PEM.test(pem), 'A PEM private key, or its base64');

/**
 * A key in base64 (`openssl rand -base64 32`), read back as its bytes: exactly
 * `bytes` of them, or at least as many with `atLeast`.
 */
const zBase64Key = (bytes: number, { atLeast = false } = {}) =>
  z
    .string()
    .regex(/^[A-Za-z0-9+/]+={0,2}$/, 'Base64 (openssl rand -base64 32)')
    .transform((value) => Buffer.from(value, 'base64'))
    .refine((key) => (atLeast ? key.length >= bytes : key.length === bytes), `${atLeast ? 'At least ' : ''}${bytes} bytes, in base64`);

/** The variables of the GitHub App, required where the server talks to the real GitHub. */
const GITHUB_APP_KEYS = [
  'GITHUB_APP_ID',
  'GITHUB_APP_PRIVATE_KEY',
  'GITHUB_APP_CLIENT_ID',
  'GITHUB_APP_CLIENT_SECRET',
  'GITHUB_APP_SLUG',
  'GITHUB_WEBHOOK_SECRET',
] as const;

/** The keys of the sign-in (CORE-4), required where Pilotes sign in for good. */
const AUTH_KEYS = ['GITHUB_TOKEN_KEY', 'SESSION_SECRET'] as const;

/** Where the page is served without `PUBLIC_URL`: Vite's dev server (`apps/web/vite.config.ts`). */
const DEV_APP_URL = 'http://localhost:4200';

/** The server's environment, parsed once at boot (`main.ts`). */
export const zEnv = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    /** Where this server runs: one image, two Compose projects (ADR 0009). */
    CREWDECK_ENV: z.enum(['production', 'staging', 'development', 'test']),
    /**
     * The URL the Pilote opens, the page's origin (the `APP_URL` of CORE-4):
     * the OAuth callback's and the `Origin` every non-`GET` must carry.
     * Required outside development and test, `http://localhost:4200` there.
     */
    PUBLIC_URL: zHttpUrl.optional(),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    CREWDECK_COMMIT: z.string().min(1).default('dev'),
    /** The web build the server serves at `/`; unset in development, where Vite serves the page. */
    WEB_DIST_DIR: z.string().min(1).optional(),
    /** The Runner binaries of the same commit, `<dir>/<commit>/<os>-<arch>` (ADR 0004). */
    RUNNER_DIST_DIR: z.string().min(1).optional(),
    /** The GitHub App of this environment (ADR 0002), required in production and staging. */
    GITHUB_APP_ID: z.string().min(1).optional(),
    GITHUB_APP_PRIVATE_KEY: zPrivateKey.optional(),
    GITHUB_APP_CLIENT_ID: z.string().min(1).optional(),
    GITHUB_APP_CLIENT_SECRET: z.string().min(1).optional(),
    GITHUB_APP_SLUG: z.string().min(1).optional(),
    /**
     * The App's webhook secret: `X-Hub-Signature-256` is its HMAC of each
     * delivery (PROJET-1). Unset in development and test, every delivery is
     * refused.
     */
    GITHUB_WEBHOOK_SECRET: z.string().min(1).optional(),
    /** GitHub's API and site: GitHub.com's unless set. */
    GITHUB_API_URL: zHttpUrl.default('https://api.github.com'),
    GITHUB_WEB_URL: zHttpUrl.default('https://github.com'),
    /**
     * 32 bytes in base64: encrypts the Pilotes' GitHub tokens at rest (ADR
     * 0002). Losing it signs every Pilote out. Required outside development
     * and test, drawn at each boot there.
     */
    GITHUB_TOKEN_KEY: zBase64Key(32).optional(),
    /** At least 32 bytes in base64: signs the sign-in's short-lived cookie. Same rule as GITHUB_TOKEN_KEY. */
    SESSION_SECRET: zBase64Key(32, { atLeast: true }).optional(),
    /**
     * `1`: the fake GitHub (and the fake Runner) in place of the real ones,
     * with the test scenarios (`pnpm dev`, the end-to-end tests). Refused in
     * production.
     */
    CREWDECK_FAKES: z.literal('1').optional(),
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
    const deployed = env.CREWDECK_ENV === 'production' || env.CREWDECK_ENV === 'staging';
    if (deployed) {
      require('PUBLIC_URL', 'outside development and test');
      for (const key of GITHUB_APP_KEYS) require(key, 'outside development and test');
      for (const key of AUTH_KEYS) require(key, 'outside development and test');
    }
    if (env.CREWDECK_FAKES !== undefined && (deployed || env.NODE_ENV === 'production')) {
      context.addIssue({ code: 'custom', path: ['CREWDECK_FAKES'], message: 'Refused in production: the fakes never replace GitHub there' });
    }
    if (env.CREWDECK_ENV === 'staging') {
      require('PROD_PUBLIC_URL', 'in staging');
      require('PROD_GITHUB_APP_ID', 'in staging');
    }
  });
export type Env = z.infer<typeof zEnv>;

/** Whether this server runs for real Pilotes: production or staging. */
export const isDeployed = (env: Env): boolean => env.CREWDECK_ENV === 'production' || env.CREWDECK_ENV === 'staging';

/** The page's origin (`https://crewdeck.example`): `PUBLIC_URL`'s, else Vite's dev server. */
export const appOrigin = (env: Env): string => new URL(env.PUBLIC_URL ?? DEV_APP_URL).origin;

/** Whether the fakes replace GitHub and the Runner (`CREWDECK_FAKES=1`). */
export const usesFakes = (env: Env): boolean => env.CREWDECK_FAKES === '1';

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
