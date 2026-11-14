import { zState } from '@crewdeck/contracts';
import type { INestApplication } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import pg from 'pg';
import { inject } from 'vitest';
import { SESSION_COOKIE } from '../../src/auth/cookies.js';
import { WebSessions } from '../../src/auth/web-sessions.js';
import { parseEnv } from '../../src/config/env.js';
import { newId } from '../../src/ids.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { EventsRetention } from '../../src/realtime/retention.job.js';
import { runInPilotScope } from '../../src/scope/scope.context.js';
import { expectEnvelope, startApp } from '../route-baseline.js';

const databaseUrl = inject('databaseUrl');
const DAY_MS = 24 * 60 * 60 * 1000;

const sql = async <T extends pg.QueryResultRow>(text: string, values: unknown[] = []): Promise<T[]> => {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    return (await client.query<T>(text, values)).rows;
  } finally {
    await client.end();
  }
};

describe('the snapshot and the retention against PostgreSQL', () => {
  let app: INestApplication;
  let url: string;

  beforeAll(async () => {
    ({ app, url } = await startApp(parseEnv({ CREWDECK_ENV: 'test', DATABASE_URL: databaseUrl })));
  });

  afterAll(async () => {
    await sql('TRUNCATE pilots CASCADE');
    await app.close();
  });

  beforeEach(() => sql('TRUNCATE pilots CASCADE'));

  const pilot = async (login: string, seq: number): Promise<{ id: string; cookie: string }> => {
    const id = newId();
    await sql(`INSERT INTO pilots (id, github_user_id, login, avatar_url, time_zone, seq) VALUES ($1, $2, $3, NULL, 'Europe/Paris', $4)`, [
      id,
      Math.floor(Math.random() * 1e9),
      login,
      seq,
    ]);
    const prisma = app.get(PrismaService);
    const token = await runInPilotScope(id, () => app.get(WebSessions).open(prisma.scoped, id, undefined));
    return { id, cookie: `${SESSION_COOKIE}=${token}` };
  };

  describe('GET /api/state', () => {
    it('returns the seq it reflects and every slice, matching zState', async () => {
      const alice = await pilot('alice', 12);
      await pilot('bob', 40);

      const res = await fetch(`${url}/api/state`, { headers: { cookie: alice.cookie } });

      expect(res.status).toBe(200);
      const body = zState.parse(await res.json());
      expect(body).toEqual({ seq: 12, pilot: { id: alice.id, login: 'alice', avatarUrl: null, timeZone: 'Europe/Paris', gettingStartedStep: 'runner' }, runner: null, 'runner-link': null, 'ai-account': [], usage: [], devices: [], decisions: [] });
    });

    it('answers 401 without a session', async () => {
      await expectEnvelope(await fetch(`${url}/api/state`), 401, 'auth.required');
    });
  });

  describe('the retention job', () => {
    it('runs every day at 04:00 UTC', () => {
      const job = app.get(SchedulerRegistry).getCronJob('events-retention');

      const next = job.nextDate().toUTC();
      expect([next.hour, next.minute, next.second]).toEqual([4, 0, 0]);
      expect(job.nextDates(2).map((date) => date.toUTC().toMillis() - next.toMillis())).toEqual([0, DAY_MS]);
    });

    it('deletes the events older than 7 days, of every Pilote, and keeps the others', async () => {
      const alice = await pilot('alice', 2);
      const bob = await pilot('bob', 1);
      const now = new Date('2026-11-11T04:00:00.000Z');
      const insert = (pilotId: string, seq: number, ageDays: number) =>
        sql(`INSERT INTO events (pilot_id, seq, type, payload, at) VALUES ($1, $2, 'pilot.upserted', '{}', $3)`, [pilotId, seq, new Date(now.getTime() - ageDays * DAY_MS)]);
      await insert(alice.id, 1, 8);
      await insert(alice.id, 2, 6);
      await insert(bob.id, 1, 8);

      const deleted = await app.get(EventsRetention).purge(now);

      expect(deleted).toBe(2);
      expect(await sql('SELECT pilot_id, seq FROM events')).toEqual([{ pilot_id: alice.id, seq: '2' }]);
    });
  });
});
