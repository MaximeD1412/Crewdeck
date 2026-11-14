import {
  DEVICE_HEADER,
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
  zDevice,
  zHelloAccepted,
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
import { pairingSides, type PairingSides } from '../fakes/pairing.js';
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
    sent.length = 0;
  });

  afterEach(async () => {
    await Promise.all(sockets.splice(0).map((socket) => socket.close()));
    clock.now = () => new Date();
  });

  const pilot = async (login = 'octocat', step = 'runner'): Promise<Tab> => {
    const id = newId();
    await sql(`INSERT INTO pilots (id, display_name, time_zone, getting_started_step) VALUES ($1, $2, 'Europe/Paris', $3)`, [
      id,
      login,
      step,
    ]);
    const token = await runInPilotScope(id, () => app.get(WebSessions).open(prisma.scoped, id, undefined));
    return { id, cookie: `${SESSION_COOKIE}=${token}` };
  };

  /** Every body a request of these tests sent: none may carry a secret nor a vault key. */
  const sent: string[] = [];

  /** A request of the page: its cookie and its origin, its Appareil in `X-Crewdeck-Device` once it has one. */
  const page = (tab: Tab, path: string, body?: unknown, deviceId?: string): Promise<Response> => {
    const text = body === undefined ? undefined : JSON.stringify(body);
    if (text) sent.push(text);
    return fetch(`${url}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { cookie: tab.cookie, origin: ORIGIN, 'content-type': 'application/json', ...(deviceId ? { [DEVICE_HEADER]: deviceId } : {}) },
      ...(text === undefined ? {} : { body: text }),
    });
  };

  /** A request of the binary or of `install.sh`: no session. */
  const binary = (path: string, body?: unknown): Promise<Response> => {
    const text = body === undefined ? undefined : JSON.stringify(body);
    if (text) sent.push(text);
    return fetch(`${url}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'content-type': 'application/json' },
      ...(text === undefined ? {} : { body: text }),
    });
  };

  const state = async (tab: Tab) => zState.parse(await (await page(tab, '/api/state')).json());

  /** The page draws a code for its Appareil: a new one, or the one `deviceId` names. */
  const drawCode = async (tab: Tab, sides: PairingSides = pairingSides(), deviceId?: string) => {
    const res = await page(tab, '/api/runner/link-codes', { pairing: sides.browser() }, deviceId);
    expect(res.status).toBe(201);
    return { ...zRunnerLinkCodeCreated.parse(await res.json()), sides };
  };

  type Code = Awaited<ReturnType<typeof drawCode>>;

  /** The Runner's side up to `pending` with its pairing, as `crewdeck-runner link` does it. */
  const linkAndPair = async (code: Code, machine: Partial<Omit<RunnerLinkRequest, 'shortId'>> = {}) => {
    const res = await binary('/api/runner/link', { ...MACHINE, ...machine, shortId: code.shortId });
    expect(res.status).toBe(202);
    const accepted = zRunnerLinkAccepted.parse(await res.json());
    expect((await binary(`/api/runner/link/${accepted.linkId}/pairing`, { pairing: code.sides.runner(code.shortId) })).status).toBe(204);
    return accepted;
  };

  /** The page confirms: the first Appareil wraps a new vault key for itself and the Runner, a trusted one for the Runner only. */
  const confirm = async (tab: Tab, code: Code, { version = 1, first = true } = {}) =>
    page(tab, `/api/runner/link-codes/${code.id}/confirm`, { pairing: code.sides.confirm(code.shortId, version, first), seq: (await state(tab)).seq }, code.deviceId);

  /** The whole link: the code, the Runner pending, the page's confirmation, the token. */
  const link = async (
    tab: Tab,
    machine: Partial<Omit<RunnerLinkRequest, 'shortId'>> = {},
    { sides = pairingSides(), deviceId, version = 1, first = true }: { sides?: PairingSides; deviceId?: string; version?: number; first?: boolean } = {},
  ) => {
    const code = await drawCode(tab, sides, deviceId);
    const { linkId } = await linkAndPair(code, machine);
    const res = await confirm(tab, code, { version, first });
    expect(res.status).toBe(200);
    const { runner } = zRunnerLinkConfirmed.parse(await res.json());
    const status = zRunnerLinkStatus.parse(await (await binary(`/api/runner/link/${linkId}`)).json());
    return { runner, token: status.token ?? '', status, linkId, code };
  };

  /** Every row of every table, as text: none may hold a secret nor a vault key. */
  const everyColumn = async (): Promise<string> => {
    const tables = await sql<{ tablename: string }>("SELECT tablename FROM pg_tables WHERE schemaname = 'public'");
    const rows = await Promise.all(tables.map(({ tablename }) => sql<{ row: string }>(`SELECT row_to_json(t)::text AS row FROM "${tablename}" t`)));
    return rows.flat().map(({ row }) => row).join('\n');
  };

  const wrapsOf = (pilotId: string) =>
    sql<{ holder_type: string; holder_id: string; vault_key_version: number }>(
      'SELECT holder_type, holder_id, vault_key_version FROM vault_key_wraps WHERE pilot_id = $1 ORDER BY holder_type, created_at',
      [pilotId],
    );

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
      expect(zRunnerLink.parse(slice)).toEqual({
        id: code.id,
        shortId: code.shortId,
        state: 'waiting',
        failureReason: null,
        expiresAt: code.expiresAt,
        runnerId: null,
        runnerPairing: null,
      });
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
      await expectFields(await page(alice, '/api/runner/link-codes', { pairing: { devicePublicKey: 'court', deviceName: ' ' } }), ['pairing.devicePublicKey', 'pairing.deviceName']);
      await expectEnvelope(await binary('/api/runner/link-codes', { pairing: pairingSides().browser() }), 401, 'auth.required');
    });
  });

  describe('POST /api/runner/link', () => {
    it('makes the code pending with the Runner’s machine and gives the page’s pairing', async () => {
      const alice = await pilot();
      const code = await drawCode(alice);

      const accepted = await linkAndPair(code);

      expect(accepted).toEqual({ linkId: code.id, browserPairing: code.sides.browser() });
      expect((await state(alice))['runner-link']).toMatchObject({ state: 'pending', runnerId: expect.any(String), runnerPairing: code.sides.runner(code.shortId) });
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
      await linkAndPair(code);

      await expectEnvelope(await binary('/api/runner/link', { ...MACHINE, shortId: code.shortId }), 422, 'runner.link-code-used');
      expect((await state(alice))['runner-link']).toMatchObject({ state: 'failed', failureReason: 'already-used' });
      await expectEnvelope(await confirm(alice, code), 409, 'runner.link-not-pending');
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

      const pairing = code.sides.runner(code.shortId);

      await expectEnvelope(await binary(`/api/runner/link/${code.id}/pairing`, { pairing }), 409, 'runner.link-not-pending');
      await linkAndPair(code);
      await expectEnvelope(await binary(`/api/runner/link/${code.id}/pairing`, { pairing }), 409, 'runner.link-not-pending');
      await expectEnvelope(await binary(`/api/runner/link/${newId()}/pairing`, { pairing }), 404, 'runner.link-code-unknown');
      await expectEnvelope(await binary('/api/runner/link/pas-un-id/pairing', { pairing }), 404, 'runner.link-code-unknown');
      await expectFields(await binary(`/api/runner/link/${code.id}/pairing`, {}), ['pairing']);
      await expectFields(await binary(`/api/runner/link/${code.id}/pairing`, { pairing: { runnerPublicKey: 'x', proof: '' } }), ['pairing.runnerPublicKey', 'pairing.proof']);
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

      await expectEnvelope(await confirm(alice, code), 409, 'runner.link-not-pending');
      await binary('/api/runner/link', { ...MACHINE, shortId: code.shortId });
      await expectEnvelope(await confirm(alice, code), 409, 'runner.link-not-pending');
    });

    it('answers 409 realtime.stale with the seq of an older state of the code', async () => {
      const alice = await pilot();
      const code = await drawCode(alice);
      const before = (await state(alice)).seq;
      await linkAndPair(code);

      await expectEnvelope(await page(alice, `/api/runner/link-codes/${code.id}/confirm`, { pairing: code.sides.confirm(code.shortId), seq: before }), 409, 'realtime.stale');
    });

    it('answers 404 for another Pilote’s code or an id that is none, 401 without a session, 400 with fields', async () => {
      const alice = await pilot('alice');
      const bob = await pilot('bob');
      const code = await drawCode(alice);
      await linkAndPair(code);

      await expectEnvelope(await confirm(bob, code), 404, 'runner.link-code-unknown');
      await expectEnvelope(await page(alice, '/api/runner/link-codes/pas-un-id/confirm', { pairing: code.sides.confirm(code.shortId), seq: 0 }), 404, 'runner.link-code-unknown');
      await expectEnvelope(await binary(`/api/runner/link-codes/${code.id}/confirm`, { pairing: code.sides.confirm(code.shortId), seq: 0 }), 401, 'auth.required');
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

      const second = await link(alice, { machine: 'portable' }, { deviceId: first.code.deviceId, sides: first.code.sides, first: false });

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
      await linkAndPair(code);
      advance(LINK_CODE_TTL_SECONDS + 1);

      await expectEnvelope(await confirm(alice, code), 409, 'runner.link-not-pending');
      expect((await state(alice))['runner-link']).toMatchObject({ state: 'expired', failureReason: 'expired' });
    });
  });

  describe('the first Appareil (E2E-2)', () => {
    it('ends a full link with a trusted Appareil, a Runner and two wraps of version 1, device.upserted in the confirm’s transaction', async () => {
      const alice = await pilot();

      const { runner, code, status, token } = await link(alice);

      const devices = (await state(alice)).devices;
      expect(devices).toEqual([expect.objectContaining({ id: code.deviceId, name: 'Chrome sur Linux', state: 'trusted', approvedAt: expect.any(String), current: false })]);
      expect(await wrapsOf(alice.id)).toEqual([
        { holder_type: 'device', holder_id: code.deviceId, vault_key_version: 1 },
        { holder_type: 'runner', holder_id: runner.id, vault_key_version: 1 },
      ]);
      expect(status.runnerId).toBe(runner.id);
      expect(status.pairing).toEqual({ proof: code.sides.confirm(code.shortId).proof, vaultKeyVersion: 1, runnerVaultWrap: code.sides.confirm(code.shortId).runnerVaultWrap });
      const [pilotRow] = await sql<{ vault_key_version: number }>('SELECT vault_key_version FROM pilots WHERE id = $1', [alice.id]);
      expect(pilotRow?.vault_key_version).toBe(1);
      // xmin: the transaction that inserted the row.
      const events = await sql<{ type: string; payload: { state?: string }; tx: string }>('SELECT type, payload, xmin::text AS tx FROM events WHERE pilot_id = $1 ORDER BY seq', [alice.id]);
      const trusted = events.find((event) => event.type === 'device.upserted' && event.payload.state === 'trusted');
      const created = events.find((event) => event.type === 'runner.upserted');
      expect(zDevice.parse(trusted?.payload)).toMatchObject({ state: 'trusted' });
      expect(trusted?.tx).toBe(created?.tx);
      // Drawn pending; seen (`lastSeenAt`) when its page confirms; trusted by the confirmation.
      expect(events.filter((event) => event.type === 'device.upserted').map((event) => event.payload.state)).toEqual(['pending', 'pending', 'trusted']);

      const socket = await connectRunner(url, token);
      sockets.push(socket);
      socket.hello();
      expect(zHelloAccepted.parse(await socket.expect('hello.accepted')).vaultKeyWrap).toEqual({ vaultKeyVersion: 1, ...code.sides.confirm(code.shortId).runnerVaultWrap });
    });

    it('never sends nor stores the link’s secret nor the vault key', async () => {
      const alice = await pilot();

      const { code } = await link(alice);

      const columns = await everyColumn();
      for (const leak of code.sides.leaks()) {
        expect(sent.join('\n')).not.toContain(leak);
        expect(columns).not.toContain(leak);
      }
      // What the server keeps instead: the public keys.
      expect(columns).toContain(Buffer.from(code.sides.devicePublicKey, 'base64url').toString('hex'));
    });

    it('reuses the Appareil its page names with the same key; a new one for another key or another Pilote’s', async () => {
      const alice = await pilot('alice');
      const bob = await pilot('bob');
      const first = await drawCode(alice);

      const again = await drawCode(alice, first.sides, first.deviceId);
      const otherKey = await drawCode(alice, pairingSides(), first.deviceId);
      const bobs = await drawCode(bob, first.sides, first.deviceId);

      expect(again.deviceId).toBe(first.deviceId);
      expect(otherKey.deviceId).not.toBe(first.deviceId);
      expect(bobs.deviceId).not.toBe(first.deviceId);
      expect((await state(alice)).devices.map((device) => device.id).sort()).toEqual([first.deviceId, otherKey.deviceId].sort());
    });

    it('relinks from a trusted Appareil: the same vault key wrapped for the new Runner, its version unchanged', async () => {
      const alice = await pilot();
      const first = await link(alice);

      const second = await link(alice, { machine: 'portable' }, { deviceId: first.code.deviceId, sides: first.code.sides, first: false });

      expect(second.code.deviceId).toBe(first.code.deviceId);
      expect(await wrapsOf(alice.id)).toEqual([
        { holder_type: 'device', holder_id: first.code.deviceId, vault_key_version: 1 },
        { holder_type: 'runner', holder_id: first.runner.id, vault_key_version: 1 },
        { holder_type: 'runner', holder_id: second.runner.id, vault_key_version: 1 },
      ]);
      expect(second.status.pairing?.vaultKeyVersion).toBe(1);
      const [pilotRow] = await sql<{ vault_key_version: number }>('SELECT vault_key_version FROM pilots WHERE id = $1', [alice.id]);
      expect(pilotRow?.vault_key_version).toBe(1);
    });

    it('answers 422 devices.not-trusted to a relink from an untrusted browser: the code failed device-not-trusted, no Runner, no wrap', async () => {
      const alice = await pilot();
      const first = await link(alice);
      const code = await drawCode(alice);
      const { linkId } = await linkAndPair(code);

      await expectEnvelope(await confirm(alice, code, { first: false }), 422, 'devices.not-trusted');

      expect((await state(alice))['runner-link']).toMatchObject({ id: code.id, state: 'failed', failureReason: 'device-not-trusted' });
      expect(await (await binary(`/api/runner/link/${linkId}`)).json()).toEqual({ state: 'failed', reason: 'device-not-trusted' });
      expect((await state(alice)).runner?.id).toBe(first.runner.id);
      expect(await wrapsOf(alice.id)).toHaveLength(2);
    });

    it('answers 422 runner.link-pairing-invalid to a confirmation the vault cannot take, the code still pending', async () => {
      const alice = await pilot();
      const code = await drawCode(alice);
      await linkAndPair(code);

      await expectEnvelope(await confirm(alice, code, { first: false }), 422, 'runner.link-pairing-invalid');
      await expectEnvelope(await confirm(alice, code, { version: 2 }), 422, 'runner.link-pairing-invalid');

      expect((await state(alice))['runner-link']).toMatchObject({ state: 'pending' });
      expect(await wrapsOf(alice.id)).toEqual([]);
      expect((await confirm(alice, code)).status).toBe(200);
    });
  });

  describe('POST /api/runner/link-codes/:id/reject', () => {
    it('fails the pending code pairing-mismatch: the binary reads it, the page draws a new code', async () => {
      const alice = await pilot();
      const code = await drawCode(alice);
      const { linkId } = await linkAndPair(code);

      const res = await page(alice, `/api/runner/link-codes/${code.id}/reject`, { reason: 'pairing-mismatch', seq: (await state(alice)).seq });

      expect(res.status).toBe(204);
      expect((await state(alice))['runner-link']).toMatchObject({ id: code.id, state: 'failed', failureReason: 'pairing-mismatch' });
      expect((await eventsOf(alice.id, 'runner-link.upserted')).at(-1)).toMatchObject({ state: 'failed', failureReason: 'pairing-mismatch' });
      expect(await (await binary(`/api/runner/link/${linkId}`)).json()).toEqual({ state: 'failed', reason: 'pairing-mismatch' });
      expect(await wrapsOf(alice.id)).toEqual([]);
    });

    it('answers 409 to a code not pending or an older seq, 404 to another Pilote’s, 401 without a session, 400 with fields', async () => {
      const alice = await pilot('alice');
      const bob = await pilot('bob');
      const code = await drawCode(alice);
      const before = (await state(alice)).seq;
      const reject = (tab: Tab, seq: number, id = code.id) => page(tab, `/api/runner/link-codes/${id}/reject`, { reason: 'pairing-mismatch', seq });

      await expectEnvelope(await reject(alice, before), 409, 'runner.link-not-pending');
      await linkAndPair(code);
      await expectEnvelope(await reject(alice, before), 409, 'realtime.stale');
      await expectEnvelope(await reject(bob, 0), 404, 'runner.link-code-unknown');
      await expectEnvelope(await binary(`/api/runner/link-codes/${code.id}/reject`, { reason: 'pairing-mismatch', seq: 0 }), 401, 'auth.required');
      await expectFields(await page(alice, `/api/runner/link-codes/${code.id}/reject`, { reason: 'expired' }), ['reason', 'seq']);
      expect((await state(alice))['runner-link']).toMatchObject({ state: 'pending' });
    });
  });

  describe('GET /api/runner/link/:linkId', () => {
    it('is pending, then linked with the token exactly once', async () => {
      const alice = await pilot();
      const code = await drawCode(alice);
      const { linkId } = await linkAndPair(code);
      expect(await (await binary(`/api/runner/link/${linkId}`)).json()).toEqual({ state: 'pending' });
      expect((await confirm(alice, code)).status).toBe(200);

      const first = zRunnerLinkStatus.parse(await (await binary(`/api/runner/link/${linkId}`)).json());
      const second = zRunnerLinkStatus.parse(await (await binary(`/api/runner/link/${linkId}`)).json());

      const { deviceVaultWrap: _, ...linked } = code.sides.confirm(code.shortId);
      expect(first).toEqual({ state: 'linked', runnerId: expect.any(String), token: expect.any(String), pairing: linked });
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
      await linkAndPair(used);
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
