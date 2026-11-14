import type { INestApplication } from '@nestjs/common';
import pg from 'pg';
import { inject } from 'vitest';
import { SESSION_COOKIE } from '../../src/auth/cookies.js';
import { WebSessions } from '../../src/auth/web-sessions.js';
import { appOrigin, parseEnv } from '../../src/config/env.js';
import { newId } from '../../src/ids.js';
import { LatencyRetention } from '../../src/metrics/latency.retention.js';
import { LatencyService } from '../../src/metrics/latency.service.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { ScopeViolationError } from '../../src/scope/prisma-scope.extension.js';
import { runInPilotScope } from '../../src/scope/scope.context.js';
import { expectEnvelope, expectFields, startApp } from '../route-baseline.js';

const databaseUrl = inject('databaseUrl');
const env = parseEnv({ CREWDECK_ENV: 'test', DATABASE_URL: databaseUrl });
const ORIGIN = appOrigin(env);
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

interface SampleRow {
  pilot_id: string;
  source: string;
  delay_ms: number;
  at: Date;
}

describe('the measured latency against PostgreSQL (CORE-8)', () => {
  let app: INestApplication;
  let url: string;
  let prisma: PrismaService;
  let latency: LatencyService;

  beforeAll(async () => {
    ({ app, url } = await startApp(env));
    prisma = app.get(PrismaService);
    latency = app.get(LatencyService);
  });

  afterAll(async () => {
    await sql('TRUNCATE pilots CASCADE');
    await app.close();
  });

  beforeEach(() => sql('TRUNCATE pilots CASCADE'));

  /** A Pilote with a session: their id and the cookie of a tab. */
  const pilot = async (login = 'octocat'): Promise<{ id: string; cookie: string }> => {
    const id = newId();
    await sql(`INSERT INTO pilots (id, display_name, time_zone) VALUES ($1, $2, 'Europe/Paris')`, [id, login]);
    const token = await runInPilotScope(id, () => app.get(WebSessions).open(prisma.scoped, id, undefined));
    return { id, cookie: `${SESSION_COOKIE}=${token}` };
  };

  const sample = (delayMs: number, at = new Date()) => ({ seq: '12', source: 'github', delayMs, at: at.toISOString() });

  /** `POST /api/metrics/latency` as the page sends it, JSON by default. */
  const post = (cookie: string | undefined, body: unknown, contentType = 'application/json'): Promise<Response> =>
    fetch(`${url}/api/metrics/latency`, {
      method: 'POST',
      headers: { origin: ORIGIN, 'content-type': contentType, ...(cookie ? { cookie } : {}) },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });

  const samples = (): Promise<SampleRow[]> => sql<SampleRow>('SELECT pilot_id, source, delay_ms, at FROM latency_samples ORDER BY delay_ms');

  /** Writes `delays` for `pilotId`, measured `ageMs` ago. */
  const seed = (pilotId: string, delays: number[], ageMs = 0): Promise<unknown> =>
    sql(
      `INSERT INTO latency_samples (id, pilot_id, source, delay_ms, at)
       SELECT gen_random_uuid(), $1, 'runner', d, now() - make_interval(secs => $3::double precision / 1000) FROM unnest($2::int[]) AS d`,
      [pilotId, delays, ageMs],
    );

  describe('POST /api/metrics/latency', () => {
    it('answers 204 and writes each sample in the Pilote’s name', async () => {
      const alice = await pilot();
      const at = new Date('2026-11-11T08:00:00.300Z');

      const res = await post(alice.cookie, { samples: [sample(300, at), { ...sample(1200, at), source: 'runner' }] });

      expect(res.status).toBe(204);
      expect(await samples()).toEqual([
        { pilot_id: alice.id, source: 'github', delay_ms: 300, at },
        { pilot_id: alice.id, source: 'runner', delay_ms: 1200, at },
      ]);
    });

    it('reads the batch sendBeacon sends as text/plain', async () => {
      const alice = await pilot();

      const res = await post(alice.cookie, { samples: [sample(450)] }, 'text/plain;charset=UTF-8');

      expect(res.status).toBe(204);
      expect(await samples()).toEqual([expect.objectContaining({ delay_ms: 450 })]);
    });

    it('drops a sample of 20 min (a clock off), and writes the others', async () => {
      const alice = await pilot();

      expect((await post(alice.cookie, { samples: [sample(20 * 60_000), sample(800)] })).status).toBe(204);
      expect((await post(alice.cookie, { samples: [sample(20 * 60_000)] })).status).toBe(204);

      expect((await samples()).map((row) => row.delay_ms)).toEqual([800]);
    });

    it('answers 400 with fields on a negative delay or no sample, and writes nothing', async () => {
      const alice = await pilot();

      await expectFields(await post(alice.cookie, { samples: [sample(300), sample(-5)] }), ['samples.1.delayMs']);
      await expectFields(await post(alice.cookie, { samples: [] }), ['samples']);
      expect(await samples()).toEqual([]);
    });

    it('answers 400 to a text/plain body that is not JSON, 413 to one over 64 kB', async () => {
      const alice = await pilot();

      await expectEnvelope(await post(alice.cookie, '{"samples": [', 'text/plain'), 400, 'http.bad-request');
      await expectEnvelope(await post(alice.cookie, `{"pad": "${'x'.repeat(70_000)}"}`, 'text/plain'), 413, 'http.bad-request');
      expect(await samples()).toEqual([]);
    });

    it('answers 401 without a session', async () => {
      await expectEnvelope(await post(undefined, { samples: [sample(300)] }), 401, 'auth.required');
      await expectEnvelope(await post(undefined, { samples: [sample(300)] }, 'text/plain'), 401, 'auth.required');
      expect(await samples()).toEqual([]);
    });
  });

  describe('LatencyService.p95', () => {
    const p95 = (pilotId: string) => runInPilotScope(pilotId, () => latency.p95(pilotId, { days: 7 }));

    it('is 95 (± 1) over the samples 1..100 ms', async () => {
      const alice = await pilot();
      await seed(
        alice.id,
        Array.from({ length: 100 }, (_, i) => i + 1),
      );

      const { p95Ms, count } = await p95(alice.id);

      expect(count).toBe(100);
      expect(p95Ms).toBeGreaterThanOrEqual(94);
      expect(p95Ms).toBeLessThanOrEqual(96);
    });

    it('is null with no sample', async () => {
      const alice = await pilot();

      expect(await p95(alice.id)).toEqual({ p95Ms: null, count: 0 });
    });

    it('counts only the samples of the last 7 days', async () => {
      const alice = await pilot();
      await seed(alice.id, [100]);
      await seed(alice.id, [9000], 8 * DAY_MS);

      expect(await p95(alice.id)).toEqual({ p95Ms: 100, count: 1 });
    });

    it('never counts another Pilote’s samples', async () => {
      const alice = await pilot('alice');
      const bob = await pilot('bob');
      await seed(alice.id, [100, 100]);
      await seed(bob.id, [5000, 5000, 5000]);

      expect(await p95(alice.id)).toEqual({ p95Ms: 100, count: 2 });
      expect(await p95(bob.id)).toEqual({ p95Ms: 5000, count: 3 });
      await expect(runInPilotScope(alice.id, () => latency.p95(bob.id, { days: 7 }))).rejects.toBeInstanceOf(ScopeViolationError);
    });
  });

  describe('the retention', () => {
    it('deletes the samples older than 30 days, of every Pilote', async () => {
      const alice = await pilot('alice');
      const bob = await pilot('bob');
      await seed(alice.id, [100], 29 * DAY_MS);
      await seed(alice.id, [200], 31 * DAY_MS);
      await seed(bob.id, [300], 31 * DAY_MS);

      expect(await app.get(LatencyRetention).purge()).toBe(2);
      expect((await samples()).map((row) => row.delay_ms)).toEqual([100]);
    });
  });
});
