/**
 * Vitest global setup of `nx test-integration server`: creates a database of
 * its own, `crewdeck_it_<worktree slug>_<8 hex>`, in the PostgreSQL of
 * `DATABASE_URL` (the repository's `.env` when present), runs `prisma migrate
 * deploy` on it, gives its URL to the tests (`inject('databaseUrl')`) and
 * drops it after the run.
 */
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import pg from 'pg';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}

const serverRoot = resolve(import.meta.dirname, '../..');
const repositoryRoot = resolve(serverRoot, '../..');

/** PostgreSQL truncates identifiers to 63 bytes: the slug is cut so that the random part stays. */
const MAX_IDENTIFIER = 63;
const PREFIX = 'crewdeck_it_';

export const databaseName = (root: string, hex: string): string => {
  const slug = basename(root)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '_')
    .slice(0, MAX_IDENTIFIER - PREFIX.length - hex.length - 1);
  return `${PREFIX}${slug}_${hex}`;
};

const adminUrl = (): string => {
  const dotEnv = join(repositoryRoot, '.env');
  if (!process.env['DATABASE_URL'] && existsSync(dotEnv)) process.loadEnvFile(dotEnv);
  const url = process.env['DATABASE_URL'];
  if (!url) throw new Error('DATABASE_URL is not set: copy .env.example to .env and run `pnpm db:up`.');
  return url;
};

const admin = async <T>(url: string, run: (client: pg.Client) => Promise<T>): Promise<T> => {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
};

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const url = adminUrl();
  const name = databaseName(repositoryRoot, randomBytes(4).toString('hex'));
  const databaseUrl = new URL(url);
  databaseUrl.pathname = `/${name}`;

  const drop = async (): Promise<void> => {
    await admin(url, (client) => client.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`));
  };

  await admin(url, (client) => client.query(`CREATE DATABASE "${name}"`));
  try {
    execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
      cwd: serverRoot,
      env: { ...process.env, DATABASE_URL: databaseUrl.href },
      stdio: 'pipe',
    });
  } catch (error) {
    await drop();
    throw error;
  }
  project.provide('databaseUrl', databaseUrl.href);

  return drop;
}
