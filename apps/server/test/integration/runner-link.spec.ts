import {
  LINK_ATTEMPTS_PER_MINUTE,
  LINK_CODE_TTL_SECONDS,
  RUNNER_WS_CLOSE,
  zMe,
  type RunnerLinkRequest,
  zRunner,
  zRunnerLink,
  zRunnerLinkAccepted,
  zRunnerLinkCodeCreated,
  zRunnerLinkConfirmed,
  zRunnerLinkStatus,
  zState,
} from '@crewdeck/contracts';
import type { INestApplication } from '@nestjs/common';
import pg from 'pg';
import { inject } from 'vitest';
import { SESSION_COOKIE } from '../../src/auth/cookies.js';
import { WebSessions } from '../../src/auth/web-sessions.js';
import { appOrigin, parseEnv } from '../../src/config/env.js';
import { newId } from '../../src/ids.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { RunnerClock } from '../../src/runners/clock.js';
import { RunnerLinkLimiter } from '../../src/runners/link/link-limiter.js';
import { RunnerLinkSweep } from '../../src/runners/link/runner-link-sweep.job.js';
import { runInPilotScope } from '../../src/scope/scope.context.js';
import { createLinkedRunner } from '../../src/testing/runners.js';
import { connectRunner, type FakeRunnerClient } from '../fakes/runner.js';
import { expectEnvelope, expectFields, startApp } from '../route-baseline.js';

const databaseUrl = inject('databaseUrl');
const env = parseEnv({ CREWDECK_ENV: 'test', DATABASE_URL: databaseUrl, CREWDECK_COMMIT: 'abc1234' });
const ORIGIN = appOrigin(env);

const sql = async <T extends pg.QueryResultRow>(text: string, values: unknown[] = []): Promise<T[]> => {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    return (await client.query<T>(text, values)).rows;
  } finally {
    await client.end();
  }
};

const MACHINE = { machine: 'atelier', os: 'linux', arch: 'amd64', wsl: true, runnerVersion: '0.1.0', engines: ['claude'] } as const;

interface Tab {
  id: string;
  cookie: string;
}

describe('linking a Runner against PostgreSQL', () => {
  let app: INestApplication;
  let url: string;
  let prisma: PrismaService;
  let clock: RunnerClock;
  const sockets: FakeRunnerClient[] = [];

  beforeAll(async () => {
    ({ app, url } = await startApp(env));
    prisma = app.get(PrismaService);
    clock = app.get(RunnerClock);
  });

  afterAll(async () => {
    await sql('TRUNCATE pilots CASCADE');
    await app.close();
  });

  beforeEach(async () => {
    await sql('TRUNCATE pilots CASCADE');
    app.get(RunnerLinkLimiter).reset();
  });

  afterEach(async () => {
    await Promise.all(sockets.splice(0).map((socket) => socket.close()));
    clock.now = () => new Date();
  });

  const pilot = async (login = 'octocat', step = 'runner'): Promise<Tab> => {
    const id = newId();
    await sql(`INSERT INTO pilots (id, github_user_id, login, time_zone, getting_started_step) VALUES ($1, $2, $3, 'Europe/Paris', $4)`, [
      id,
      Math.floor(Math.random() * 1e9),
      login,
      step,
    ]);
    const token = await runInPilotScope(id, () => app.get(WebSessions).open(prisma.scoped, id, undefined));
    return { id, cookie: `${SESSION_COOKIE}=${token}` };
  };

  /** A request of the page: its cookie and its origin. */
  const page = (tab: Tab, path: string, body?: unknown): Promise<Response> =>
    fetch(`${url}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { cookie: tab.cookie, origin: ORIGIN, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

  /** A request of the binary or of `install.sh`: no session. */
  const binary = (path: string, body?: unknown): Promise<Response> =>
    fetch(`${url}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

  const state = async (tab: Tab) => zState.parse(await (await page(tab, '/api/state')).json());

  const drawCode = async (tab: Tab) => {
    const res = await page(tab, '/api/runner/link-codes', { pairing: {} });
    expect(res.status).toBe(201);
    return zRunnerLinkCodeCreated.parse(await res.json());
  };

  /** The Runner's side up to `pending` with its pairing, as `crewdeck-runner link` does it. */
  const linkAndPair = async (shortId: string, machine: Partial<Omit<RunnerLinkRequest, 'shortId'>> = {}) => {
    const res = await binary('/api/runner/link', { ...MACHINE, ...machine, shortId });
    expect(res.status).toBe(202);
    const accepted = zRunnerLinkAccepted.parse(await res.json());
    expect((await binary(`/api/runner/link/${accepted.linkId}/pairing`, { pairing: { runner: 'opaque' } })).status).toBe(204);
    return accepted;
  };

  const confirm = async (tab: Tab, id: string) => page(tab, `/api/runner/link-codes/${id}/confirm`, { pairing: { browser: 'opaque' }, seq: (await state(tab)).seq });

  /** The whole link: the code, the Runner pending, the page's confirmation, the token. */
  const link = async (tab: Tab, machine: Partial<Omit<RunnerLinkRequest, 'shortId'>> = {}) => {
    const code = await drawCode(tab);
    const { linkId } = await linkAndPair(code.shortId, machine);
    const res = await confirm(tab, code.id);
    expect(res.status).toBe(200);
    const { runner } = zRunnerLinkConfirmed.parse(await res.json());
    const status = zRunnerLinkStatus.parse(await (await binary(`/api/runner/link/${linkId}`)).json());
    return { runner, token: status.token ?? '', status, linkId, code };
  };

  const eventsOf = async (pilotId: string, type: string) =>
    (await sql<{ payload: Record<string, unknown> }>('SELECT payload FROM events WHERE pilot_id = $1 AND type = $2 ORDER BY seq', [pilotId, type])).map((row) => row.payload);

  const advance = (seconds: number): void => {
    const at = Date.now() + seconds * 1000;
    clock.now = () => new Date(at);
  };

  describe('POST /api/runner/link-codes', () => {
    it('draws a code without its secret, writes runner-link.upserted and the runner-link slice', async () => {
      const alice = await pilot();

      const code = await drawCode(alice);

      expect(code.shortId).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}$/);
      expect(new Date(code.expiresAt).getTime() - Date.now()).toBeGreaterThan((LINK_CODE_TTL_SECONDS - 5) * 1000);
      const slice = (await state(alice))['runner-link'];
      expect(zRunnerLink.parse(slice)).toEqual({ id: code.id, shortId: code.shortId, state: 'waiting', failureReason: null, expiresAt: code.expiresAt, runnerPairing: null });
      expect(await eventsOf(alice.id, 'runner-link.upserted')).toEqual([slice]);
    });

    it('expires the Pilote’s previous live code', async () => {
      const alice = await pilot();
      const first = await drawCode(alice);

      await drawCode(alice);

      await expectEnvelope(await binary('/api/runner/link', { ...MACHINE, shortId: first.shortId }), 422, 'runner.link-code-expired');
    });

    it('answers 400 with fields, 401 without a session', async () => {
      const alice = await pilot();

      await expectFields(await page(alice, '/api/runner/link-codes', { pairing: 'clair' }), ['pairing']);
      await expectEnvelope(await binary('/api/runner/link-codes', { pairing: {} }), 401, 'auth.required');
    });
  });

  describe('POST /api/runner/link', () => {
    it('makes the code pending with the Runner’s machine and gives the page’s pairing', async () => {
      const alice = await pilot();
      const code = await drawCode(alice);

      const accepted = await linkAndPair(code.shortId);

      expect(accepted).toEqual({ linkId: code.id, browserPairing: {} });
      expect((await state(alice))['runner-link']).toMatchObject({ state: 'pending', runnerPairing: { runner: 'opaque' } });
      const [row] = await sql<{ pending_runner: unknown }>('SELECT pending_runner FROM runner_link_codes WHERE id = $1', [code.id]);
      expect(row?.pending_runner).toEqual(MACHINE);
    });

    it('refuses a short id in lowercase: the binary uppercases what the Pilote pasted', async () => {
      const alice = await pilot();
      const code = await drawCode(alice);

      expect((await binary('/api/runner/link', { ...MACHINE, shortId: code.shortId.toLowerCase() })).status).toBe(400);
    });

    it('answers 404 for an unknown code, 400 with fields for a wrong body', async () => {
      await expectEnvelope(await binary('/api/runner/link', { ...MACHINE, shortId: 'ZZZZ' }), 404, 'runner.link-code-unknown');
      await expectFields(await binary('/api/runner/link', { ...MACHINE, shortId: 'ZZZZ', os: 'windows', machine: '' }), ['os', 'machine']);
    });

    it('answers 422 runner.link-code-expired after 10 minutes (fake clock)', async () => {
      const alice = await pilot();
      const code = await drawCode(alice);
      advance(LINK_CODE_TTL_SECONDS + 1);

      await expectEnvelope(await binary('/api/runner/link', { ...MACHINE, shortId: code.shortId }), 422, 'runner.link-code-expired');
      expect((await state(alice))['runner-link']).toMatchObject({ state: 'expired', failureReason: 'expired' });
    });

    it('answers 422 runner.link-code-used to a second machine, the code failed for both', async () => {
      const alice = await pilot();
      const code = await drawCode(alice);
      await linkAndPair(code.shortId);

      await expectEnvelope(await binary('/api/runner/link', { ...MACHINE, shortId: code.shortId }), 422, 'runner.link-code-used');
      expect((await state(alice))['runner-link']).toMatchObject({ state: 'failed', failureReason: 'already-used' });
      await expectEnvelope(await confirm(alice, code.id), 409, 'runner.link-not-pending');
    });

    it('takes a code once when two machines link with it at the same time: the second 422 runner.link-code-used, the code failed', async () => {
      const alice = await pilot();
      const code = await drawCode(alice);
      // The Pilote's row, which each event's write locks, held: both requests read the code `waiting` before either commits.
      const holder = new pg.Client({ connectionString: databaseUrl });
      await holder.connect();
      try {
        await holder.query('BEGIN');
        await holder.query('SELECT id FROM pilots WHERE id = $1 FOR UPDATE', [alice.id]);
        const answers = ['pc-1', 'pc-2'].map((machine) => binary('/api/runner/link', { ...MACHINE, machine, shortId: code.shortId }));
        await vi.waitFor(async () => {
          const [waiting] = await sql<{ count: string }>(
            "SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'",
          );
          expect(Number(waiting?.count)).toBe(2);
        });
        await holder.query('COMMIT');

        expect((await Promise.all(answers)).map((res) => res.status).sort()).toEqual([202, 422]);
      } finally {
        await holder.end();
      }
      expect((await state(alice))['runner-link']).toMatchObject({ state: 'failed', failureReason: 'already-used' });
    });

    it('answers 422 runner.link-code-used once the code linked a Runner', async () => {
      const alice = await pilot();
      const { code } = await link(alice);

      await expectEnvelope(await binary('/api/runner/link', { ...MACHINE, shortId: code.shortId }), 422, 'runner.link-code-used');
    });

    it('answers 422 runner.no-engine without a Moteur, the code failed no-engine', async () => {
      const alice = await pilot();
      const code = await drawCode(alice);

      await expectEnvelope(await binary('/api/runner/link', { ...MACHINE, engines: [], shortId: code.shortId }), 422, 'runner.no-engine');
      expect((await state(alice))['runner-link']).toMatchObject({ state: 'failed', failureReason: 'no-engine' });
    });

    it(`answers 429 runner.link-rate-limited after ${LINK_ATTEMPTS_PER_MINUTE} attempts a minute from one IP`, async () => {
      for (let attempt = 0; attempt < LINK_ATTEMPTS_PER_MINUTE; attempt++) {
        expect((await binary('/api/runner/link', { ...MACHINE, shortId: 'ZZZZ' })).status).toBe(404);
      }

      await expectEnvelope(await binary('/api/runner/link', { ...MACHINE, shortId: 'ZZZZ' }), 429, 'runner.link-rate-limited');
      await expectEnvelope(await binary('/api/runner/link-failures', { shortId: 'ZZZZ', reason: 'unsupported-system', os: 'FreeBSD', arch: 'amd64' }), 429, 'runner.link-rate-limited');
      advance(61);
      expect((await binary('/api/runner/link', { ...MACHINE, shortId: 'ZZZZ' })).status).toBe(404);
    });
  });

  describe('POST /api/runner/link/:linkId/pairing', () => {
    it('answers 409 runner.link-not-pending to a second pairing or a code not pending, 404 to an unknown link', async () => {
      const alice = await pilot();
      const code = await drawCode(alice);

      await expectEnvelope(await binary(`/api/runner/link/${code.id}/pairing`, { pairing: {} }), 409, 'runner.link-not-pending');
      await linkAndPair(code.shortId);
      await expectEnvelope(await binary(`/api/runner/link/${code.id}/pairing`, { pairing: {} }), 409, 'runner.link-not-pending');
      await expectEnvelope(await binary(`/api/runner/link/${newId()}/pairing`, { pairing: {} }), 404, 'runner.link-code-unknown');
      await expectEnvelope(await binary('/api/runner/link/pas-un-id/pairing', { pairing: {} }), 404, 'runner.link-code-unknown');
      await expectFields(await binary(`/api/runner/link/${code.id}/pairing`, {}), ['pairing']);
    });
  });

  describe('POST /api/runner/link-codes/:id/confirm', () => {
    it('creates the Runner, writes runner.upserted and the code linked; GET /api/runner returns it', async () => {
      const alice = await pilot();

      const { runner, code } = await link(alice);

      expect(zRunner.parse(runner)).toMatchObject({ machine: 'atelier', os: 'linux', arch: 'amd64', wsl: true, runnerVersion: '0.1.0', state: 'offline' });
      expect(await (await page(alice, '/api/runner')).json()).toEqual(runner);
      const after = await state(alice);
      expect(after.runner).toEqual(runner);
      expect(after['runner-link']).toMatchObject({ id: code.id, state: 'linked' });
      expect(await eventsOf(alice.id, 'runner.upserted')).toEqual([runner]);
    });

    it('answers 409 runner.link-not-pending before the Runner’s pairing, or for a code waiting', async () => {
      const alice = await pilot();
      const code = await drawCode(alice);

      await expectEnvelope(await confirm(alice, code.id), 409, 'runner.link-not-pending');
      await binary('/api/runner/link', { ...MACHINE, shortId: code.shortId });
      await expectEnvelope(await confirm(alice, code.id), 409, 'runner.link-not-pending');
    });

    it('answers 409 realtime.stale with the seq of an older state of the code', async () => {
      const alice = await pilot();
      const code = await drawCode(alice);
      const before = (await state(alice)).seq;
      await linkAndPair(code.shortId);

      await expectEnvelope(await page(alice, `/api/runner/link-codes/${code.id}/confirm`, { pairing: {}, seq: before }), 409, 'realtime.stale');
    });

    it('answers 404 for another Pilote’s code or an id that is none, 401 without a session, 400 with fields', async () => {
      const alice = await pilot('alice');
      const bob = await pilot('bob');
      const code = await drawCode(alice);
      await linkAndPair(code.shortId);

      await expectEnvelope(await confirm(bob, code.id), 404, 'runner.link-code-unknown');
      await expectEnvelope(await page(alice, '/api/runner/link-codes/pas-un-id/confirm', { pairing: {}, seq: 0 }), 404, 'runner.link-code-unknown');
      await expectEnvelope(await binary(`/api/runner/link-codes/${code.id}/confirm`, { pairing: {}, seq: 0 }), 401, 'auth.required');
      await expectFields(await page(alice, `/api/runner/link-codes/${code.id}/confirm`, { pairing: [] }), ['pairing', 'seq']);
      expect((await state(alice)).runner).toBeNull();
    });

    it('revokes the previous Runner: its socket closed with 4401, its token refused, GET /api/runner the new one', async () => {
      const alice = await pilot();
      const first = await link(alice);
      const socket = await connectRunner(url, first.token);
      sockets.push(socket);
      socket.hello();
      await socket.expect('hello.accepted');

      const second = await link(alice, { machine: 'portable' });

      expect((await socket.closed()).code).toBe(RUNNER_WS_CLOSE.unauthorized);
      const again = await connectRunner(url, first.token);
      sockets.push(again);
      expect(await again.expect('hello.rejected')).toMatchObject({ reason: 'revoked' });
      expect(await (await page(alice, '/api/runner')).json()).toEqual(second.runner);
      expect((await state(alice)).runner).toMatchObject({ id: second.runner.id, machine: 'portable' });
    });

    it('answers 409 to a pending code past its 10 minutes, the code expired', async () => {
      const alice = await pilot();
      const code = await drawCode(alice);
      await linkAndPair(code.shortId);
      advance(LINK_CODE_TTL_SECONDS + 1);

      await expectEnvelope(await confirm(alice, code.id), 409, 'runner.link-not-pending');
      expect((await state(alice))['runner-link']).toMatchObject({ state: 'expired', failureReason: 'expired' });
    });
  });

  describe('GET /api/runner/link/:linkId', () => {
    it('is pending, then linked with the token exactly once', async () => {
      const alice = await pilot();
      const code = await drawCode(alice);
      const { linkId } = await linkAndPair(code.shortId);
      expect(await (await binary(`/api/runner/link/${linkId}`)).json()).toEqual({ state: 'pending' });
      expect((await confirm(alice, code.id)).status).toBe(200);

      const first = zRunnerLinkStatus.parse(await (await binary(`/api/runner/link/${linkId}`)).json());
      const second = zRunnerLinkStatus.parse(await (await binary(`/api/runner/link/${linkId}`)).json());

      expect(first).toEqual({ state: 'linked', runnerId: expect.any(String), token: expect.any(String), pairing: { browser: 'opaque' } });
      expect(second).toEqual({ state: 'linked', runnerId: first.runnerId });
      const socket = await connectRunner(url, first.token);
      sockets.push(socket);
      socket.hello();
      await socket.expect('hello.accepted');
    });

    it('is failed with the reason: expired, already used, no Moteur', async () => {
      const alice = await pilot();
      const expired = await drawCode(alice);
      advance(LINK_CODE_TTL_SECONDS + 1);
      expect(await (await binary(`/api/runner/link/${expired.id}`)).json()).toEqual({ state: 'failed', reason: 'expired' });
      clock.now = () => new Date();

      const used = await drawCode(alice);
      await linkAndPair(used.shortId);
      await binary('/api/runner/link', { ...MACHINE, shortId: used.shortId });
      expect(await (await binary(`/api/runner/link/${used.id}`)).json()).toEqual({ state: 'failed', reason: 'already-used' });

      const bare = await drawCode(alice);
      await binary('/api/runner/link', { ...MACHINE, engines: [], shortId: bare.shortId });
      expect(await (await binary(`/api/runner/link/${bare.id}`)).json()).toEqual({ state: 'failed', reason: 'no-engine' });
      await expectEnvelope(await binary(`/api/runner/link/${newId()}`), 404, 'runner.link-code-unknown');
    });
  });

  describe('POST /api/runner/link-failures', () => {
    it('marks the code failed unsupported-system; 404 unknown, 422 used, 400 with fields', async () => {
      const alice = await pilot();
      const code = await drawCode(alice);

      expect((await binary('/api/runner/link-failures', { shortId: code.shortId, reason: 'unsupported-system', os: 'FreeBSD', arch: 'amd64' })).status).toBe(204);

      expect((await state(alice))['runner-link']).toMatchObject({ state: 'failed', failureReason: 'unsupported-system' });
      await expectEnvelope(await binary('/api/runner/link-failures', { shortId: code.shortId, reason: 'unsupported-system', os: 'FreeBSD', arch: 'amd64' }), 422, 'runner.link-code-used');
      await expectEnvelope(await binary('/api/runner/link-failures', { shortId: 'ZZZZ', reason: 'unsupported-system', os: 'FreeBSD', arch: 'amd64' }), 404, 'runner.link-code-unknown');
      await expectFields(await binary('/api/runner/link-failures', { shortId: code.shortId, reason: 'no-engine', os: '', arch: 'amd64' }), ['reason', 'os']);
    });
  });

  describe('the sweep', () => {
    it('expires the live codes past their 10 minutes, each with runner-link.upserted', async () => {
      const alice = await pilot();
      const code = await drawCode(alice);
      const bob = await pilot('bob');
      const fresh = await drawCode(bob);
      advance(LINK_CODE_TTL_SECONDS - 1);
      await app.get(RunnerLinkSweep).run();
      expect((await state(alice))['runner-link']).toMatchObject({ state: 'waiting' });

      advance(LINK_CODE_TTL_SECONDS + 1);
      await app.get(RunnerLinkSweep).run();

      expect((await eventsOf(alice.id, 'runner-link.upserted')).at(-1)).toMatchObject({ id: code.id, state: 'expired', failureReason: 'expired' });
      expect((await eventsOf(bob.id, 'runner-link.upserted')).at(-1)).toMatchObject({ id: fresh.id, state: 'expired' });
    });
  });

  describe('POST /api/me/getting-started/advance', () => {
    it('answers 422 getting-started.runner-not-linked from runner without a Runner', async () => {
      const alice = await pilot();

      await expectEnvelope(await page(alice, '/api/me/getting-started/advance', { from: 'runner', seq: 0 }), 422, 'getting-started.runner-not-linked');
    });

    it('moves to the next step once the Runner is linked, with pilot.upserted', async () => {
      const alice = await pilot();
      await createLinkedRunner(prisma, alice.id);

      const res = await page(alice, '/api/me/getting-started/advance', { from: 'runner', seq: (await state(alice)).seq });

      expect(res.status).toBe(200);
      expect(zMe.parse(await res.json())).toMatchObject({ gettingStartedStep: 'ai-accounts' });
      expect(await eventsOf(alice.id, 'pilot.upserted')).toEqual([expect.objectContaining({ gettingStartedStep: 'ai-accounts' })]);
      expect(await (await page(alice, '/api/me')).json()).toMatchObject({ gettingStartedStep: 'ai-accounts' });
    });

    it('answers 409 realtime.stale from a step the Pilote is no longer at, 400 from done, 401 without a session', async () => {
      const alice = await pilot('alice', 'projects');

      await expectEnvelope(await page(alice, '/api/me/getting-started/advance', { from: 'runner', seq: 0 }), 409, 'realtime.stale');
      await expectFields(await page(alice, '/api/me/getting-started/advance', { from: 'done', seq: 0 }), ['from']);
      await expectEnvelope(await binary('/api/me/getting-started/advance', { from: 'projects', seq: 0 }), 401, 'auth.required');
      expect(await (await page(alice, '/api/me/getting-started/advance', { from: 'projects', seq: 0 })).json()).toMatchObject({ gettingStartedStep: 'done' });
    });
  });
});
