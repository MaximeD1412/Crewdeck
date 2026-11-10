import type { INestApplication } from '@nestjs/common';
import { zHealth } from '@crewdeck/contracts';
import { basename, resolve } from 'node:path';
import pg from 'pg';
import { inject } from 'vitest';
import { createApp } from '../../src/app.js';
import { parseEnv } from '../../src/config/env.js';

const databaseUrl = inject('databaseUrl');

describe('GET /api/health against PostgreSQL', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createApp(parseEnv({ CREWDECK_ENV: 'test', DATABASE_URL: databaseUrl }), { logs: false });
    await app.listen(0, '127.0.0.1');
  });

  afterAll(() => app.close());

  it('runs on a database of its own, named after the worktree', async () => {
    const slug = basename(resolve(import.meta.dirname, '../../../..'))
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '_');
    const client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();
    const { rows } = await client.query<{ name: string }>('SELECT current_database() AS name');
    await client.end();
    const name = rows[0]?.name ?? '';

    expect(name).toMatch(/^crewdeck_it_[a-z0-9_]+_[0-9a-f]{8}$/);
    expect(name.length).toBeLessThanOrEqual(63);
    expect(slug.startsWith(name.slice('crewdeck_it_'.length, -'_12345678'.length))).toBe(true);
  });

  it('says the database is ok', async () => {
    const response = await fetch(`${await app.getUrl()}/api/health`);

    expect(response.status).toBe(200);
    expect(zHealth.parse(await response.json())).toEqual({ status: 'ok', commit: 'dev', db: 'ok' });
  });
});
