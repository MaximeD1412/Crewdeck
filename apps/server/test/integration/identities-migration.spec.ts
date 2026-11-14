import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import pg from 'pg';
import { inject } from 'vitest';
import { parseEnv } from '../../src/config/env.js';
import { newId } from '../../src/ids.js';
import { FAKES, type Fakes } from '../../src/testing/fakes.js';
import { authKeysEnv } from '../github-app.js';
import { startApp } from '../route-baseline.js';

const runDatabaseUrl = inject('databaseUrl');
const APP_URL = 'https://crewdeck.example';
const MIGRATIONS = resolve(import.meta.dirname, '../../prisma/migrations');
const IDENTITIES = '20261121000000_identities';
const OCTOCAT = { id: 583231, login: 'octocat', avatarUrl: 'https://avatars.example/u/583231' };
const HUBOT = { id: 9100002, login: 'hubot', avatarUrl: 'https://avatars.example/u/9100002' };

/** The migrations' folders, in the order `prisma migrate deploy` applies them. */
const migrations = readdirSync(MIGRATIONS, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

/**
 * The migration of the Identités (CORE-9) on a database the version before
 * wrote: a database of its own, migrated up to the one before, given its
 * Pilotes the old way, then migrated to the end.
 */
describe('the migration of the Identités, against PostgreSQL', () => {
  // The run's database name is up to 63 bytes already, PostgreSQL's limit: its end gives way to the suffix.
  const name = `${new URL(runDatabaseUrl).pathname.slice(1, 60)}_mig`;
  const databaseUrl = Object.assign(new URL(runDatabaseUrl), { pathname: `/${name}` }).href;
  const oldPilot = newId();
  let app: INestApplication;
  let url: string;
  let fakes: Fakes;

  const on = async <T extends pg.QueryResultRow>(connection: string, text: string, values: unknown[] = []): Promise<T[]> => {
    const client = new pg.Client({ connectionString: connection });
    await client.connect();
    try {
      return (await client.query<T>(text, values)).rows;
    } finally {
      await client.end();
    }
  };
  const sql = <T extends pg.QueryResultRow>(text: string, values: unknown[] = []): Promise<T[]> => on<T>(databaseUrl, text, values);
  const migrate = async (folders: string[]): Promise<void> => {
    for (const folder of folders) await sql(readFileSync(join(MIGRATIONS, folder, 'migration.sql'), 'utf8'));
  };

  beforeAll(async () => {
    await on(runDatabaseUrl, `DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await on(runDatabaseUrl, `CREATE DATABASE "${name}"`);
    const at = migrations.indexOf(IDENTITIES);
    await migrate(migrations.slice(0, at));
    await sql(`INSERT INTO pilots (id, github_user_id, login, avatar_url, time_zone, getting_started_step) VALUES ($1, $2, $3, NULL, 'Europe/Paris', 'done')`, [
      oldPilot,
      OCTOCAT.id,
      OCTOCAT.login,
    ]);
    await sql(`INSERT INTO github_installations (installation_id, account_login, account_id, sender_id, pilot_id) VALUES (1, 'octocat', $1, $1, $2)`, [
      OCTOCAT.id,
      oldPilot,
    ]);
    await sql(`INSERT INTO github_installations (installation_id, account_login, account_id, sender_id) VALUES (2, 'hubot', $1, $1)`, [HUBOT.id]);
    await migrate(migrations.slice(at));

    const env = parseEnv({ CREWDECK_ENV: 'test', DATABASE_URL: databaseUrl, CREWDECK_FAKES: '1', PUBLIC_URL: APP_URL, ...authKeysEnv() });
    ({ app, url } = await startApp(env));
    fakes = app.get<Fakes>(FAKES);
  });

  afterAll(async () => {
    await app?.close();
    await on(runDatabaseUrl, `DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  });

  /** A GitHub sign-in of `user`, from `start` to the callback; the Pilote it opened a session of. */
  const signInWithGitHub = async (user: typeof OCTOCAT): Promise<string | undefined> => {
    fakes.github.reset();
    fakes.github.seedUser(user);
    const start = await fetch(`${url}/api/auth/github/start?timeZone=UTC`, { redirect: 'manual' });
    const state = new URL(start.headers.get('location') ?? '', url).searchParams.get('state') ?? '';
    const oauth = start.headers.getSetCookie().find((line) => line.startsWith('crewdeck_oauth='))?.split(';')[0] ?? '';
    const callback = await fetch(`${url}/api/auth/github/callback?${new URLSearchParams({ code: 'fake-code', state })}`, {
      redirect: 'manual',
      headers: { cookie: oauth },
    });
    expect(callback.status).toBe(302);
    const [session] = await sql<{ pilot_id: string }>('SELECT pilot_id FROM web_sessions ORDER BY created_at DESC LIMIT 1');
    return session?.pilot_id;
  };

  it('turns each github_user_id into a github Identité, and the login into the display name', async () => {
    expect(await sql('SELECT id, display_name FROM pilots')).toEqual([{ id: oldPilot, display_name: 'octocat' }]);
    expect(await sql('SELECT pilot_id, provider, subject, email, login FROM pilot_identities')).toEqual([
      { pilot_id: oldPilot, provider: 'github', subject: String(OCTOCAT.id), email: null, login: 'octocat' },
    ]);
  });

  it('signs the same GitHub user in as the same Pilote, its installation still theirs', async () => {
    expect(await signInWithGitHub(OCTOCAT)).toBe(oldPilot);

    expect(await sql('SELECT count(*)::int AS n FROM pilots')).toEqual([{ n: 1 }]);
    expect(await sql('SELECT installation_id, pilot_id FROM github_installations WHERE installation_id = 1')).toEqual([
      { installation_id: '1', pilot_id: oldPilot },
    ]);
  });

  it('links an installation made before its user signed up, at the first sign-in', async () => {
    const hubot = await signInWithGitHub(HUBOT);

    expect(hubot).not.toBe(oldPilot);
    expect(await sql('SELECT pilot_id FROM github_installations WHERE installation_id = 2')).toEqual([{ pilot_id: hubot }]);
    expect(await sql('SELECT display_name, github_user_id FROM pilots WHERE id = $1', [hubot])).toEqual([{ display_name: 'hubot', github_user_id: null }]);
  });

  it('gives a Pilote the version before writes (a rollback) its display name and its github Identité, found by a later sign-in', async () => {
    const written = newId();
    const user = { id: 9100003, login: 'rolled-back', avatarUrl: 'https://avatars.example/u/9100003' };
    await sql(`INSERT INTO pilots (id, github_user_id, login, time_zone) VALUES ($1, $2, $3, 'UTC')`, [written, user.id, user.login]);

    expect(await sql('SELECT display_name FROM pilots WHERE id = $1', [written])).toEqual([{ display_name: 'rolled-back' }]);
    expect(await sql('SELECT provider, subject, login FROM pilot_identities WHERE pilot_id = $1', [written])).toEqual([
      { provider: 'github', subject: String(user.id), login: 'rolled-back' },
    ]);
    expect(await signInWithGitHub(user)).toBe(written);
  });
});
