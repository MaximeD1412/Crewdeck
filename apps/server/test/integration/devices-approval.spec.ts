import {
  DEVICE_CODE_TTL_SECONDS,
  DEVICE_HEADER,
  PENDING_DEVICES_MAX,
  zDevice,
  zDeviceApproval,
  zDeviceCreated,
  zPendingDevice,
  zRunnerLinkStatus,
  zVaultKeyWrap,
} from '@crewdeck/contracts';
import type { INestApplication } from '@nestjs/common';
import pg from 'pg';
import { inject } from 'vitest';
import { SESSION_COOKIE } from '../../src/auth/cookies.js';
import { WebSessions } from '../../src/auth/web-sessions.js';
import { appOrigin, parseEnv } from '../../src/config/env.js';
import { DeviceClock } from '../../src/devices/device-clock.js';
import { newId } from '../../src/ids.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { runInPilotScope } from '../../src/scope/scope.context.js';
import { approvalProof, newDeviceSide, pairingSides, shapedWrap } from '../fakes/pairing.js';
import { expectEnvelope, expectFields, startApp } from '../route-baseline.js';

/**
 * A new Appareil approved by its code (E2E-3): registered pending by its
 * page, read and approved by a trusted Appareil (session) or by the Runner
 * (its token), then opened by the new page with the approval's public key.
 */

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

describe('a new Appareil approved by its code, against PostgreSQL', () => {
  let app: INestApplication;
  let url: string;
  let prisma: PrismaService;
  let clock: DeviceClock;

  beforeAll(async () => {
    ({ app, url } = await startApp(env));
    prisma = app.get(PrismaService);
    clock = app.get(DeviceClock);
  });

  afterAll(async () => {
    await sql('TRUNCATE pilots CASCADE');
    await app.close();
  });

  beforeEach(async () => {
    await sql('TRUNCATE pilots CASCADE');
  });

  afterEach(() => {
    clock.now = () => new Date();
  });

  const pilot = async (login = 'octocat'): Promise<Tab> => {
    const id = newId();
    await sql(`INSERT INTO pilots (id, github_user_id, login, time_zone, getting_started_step) VALUES ($1, $2, $3, 'Europe/Paris', 'runner')`, [
      id,
      Math.floor(Math.random() * 1e9),
      login,
    ]);
    const token = await runInPilotScope(id, () => app.get(WebSessions).open(prisma.scoped, id, undefined));
    return { id, cookie: `${SESSION_COOKIE}=${token}` };
  };

  const page = (tab: Tab | undefined, path: string, { body, deviceId }: { body?: unknown; deviceId?: string } = {}): Promise<Response> =>
    fetch(`${url}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        ...(tab ? { cookie: tab.cookie } : {}),
        origin: ORIGIN,
        'content-type': 'application/json',
        ...(deviceId ? { [DEVICE_HEADER]: deviceId } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

  const binary = (path: string, { body, token }: { body?: unknown; token?: string } = {}): Promise<Response> =>
    fetch(`${url}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

  const seq = async (tab: Tab): Promise<number> => ((await (await page(tab, '/api/state')).json()) as { seq: number }).seq;

  /** The first Appareil of `tab`'s Pilote, trusted, and the Runner it linked with its token. */
  const linked = async (tab: Tab) => {
    const sides = pairingSides();
    const code = (await (await page(tab, '/api/runner/link-codes', { body: { pairing: sides.browser('Chrome sur Linux') } })).json()) as {
      id: string;
      shortId: string;
      deviceId: string;
    };
    const accepted = (await (await binary('/api/runner/link', { body: { ...MACHINE, shortId: code.shortId } })).json()) as { linkId: string };
    await binary(`/api/runner/link/${accepted.linkId}/pairing`, { body: { pairing: sides.runner(code.shortId) } });
    const confirmed = await page(tab, `/api/runner/link-codes/${code.id}/confirm`, { body: { pairing: sides.confirm(code.shortId), seq: await seq(tab) } });
    expect(confirmed.status).toBe(200);
    const status = zRunnerLinkStatus.parse(await (await binary(`/api/runner/link/${accepted.linkId}`)).json());
    if (!status.token || !status.runnerId) throw new Error('the Runner got no token');
    return { deviceId: code.deviceId, sides, runnerId: status.runnerId, token: status.token };
  };

  /** A new Appareil registered by `tab`'s page: its side and the server's answer. */
  const register = async (tab: Tab, name?: string) => {
    const side = newDeviceSide(name);
    const res = await page(tab, '/api/devices', { body: side.request() });
    expect(res.status).toBe(201);
    return { side, created: zDeviceCreated.parse(await res.json()) };
  };

  /** What a trusted Appareil sends to approve `side`'s Appareil. */
  const approval = (side: ReturnType<typeof newDeviceSide>, approver: { type: 'device' | 'runner'; id: string; publicKey: string }, vaultKeyVersion = 1) => ({
    approver: { type: approver.type, id: approver.id },
    vaultKeyVersion,
    wrap: shapedWrap(),
    proof: approvalProof(side.secret, side.publicKey, approver.publicKey),
  });

  const events = async (pilotId: string) =>
    (await sql<{ payload: { id: string; state: string } }>(`SELECT payload FROM events WHERE pilot_id = $1 AND type = 'device.upserted' ORDER BY seq`, [pilotId])).map(
      (row) => row.payload,
    );

  describe('POST /api/devices', () => {
    it('registers a pending Appareil with a 4-character short id for 10 minutes, with device.upserted', async () => {
      const alice = await pilot();
      const now = Date.parse('2026-11-11T08:00:00.000Z');
      clock.now = () => new Date(now);

      const { side, created } = await register(alice);

      expect(created.expiresAt).toBe(new Date(now + DEVICE_CODE_TTL_SECONDS * 1000).toISOString());
      const [row] = await sql<{ state: string; short_id: string; name: string }>('SELECT state, short_id, name FROM devices WHERE id = $1', [created.id]);
      expect(row).toEqual({ state: 'pending', short_id: created.shortId, name: 'Safari sur iPhone' });
      expect(await events(alice.id)).toEqual([expect.objectContaining({ id: created.id, state: 'pending' })]);
      const stored = JSON.stringify(await sql('SELECT * FROM devices'));
      for (const leak of side.leaks()) expect(stored).not.toContain(leak);
    });

    it(`answers 422 devices.too-many-pending past ${PENDING_DEVICES_MAX} live codes; an expired one no longer counts`, async () => {
      const alice = await pilot();
      const now = Date.parse('2026-11-11T08:00:00.000Z');
      clock.now = () => new Date(now);
      for (let i = 0; i < PENDING_DEVICES_MAX; i++) await register(alice);

      await expectEnvelope(await page(alice, '/api/devices', { body: newDeviceSide().request() }), 422, 'devices.too-many-pending');

      clock.now = () => new Date(now + DEVICE_CODE_TTL_SECONDS * 1000);
      await register(alice);
    });

    it('answers 400 with the fields, 401 without a session', async () => {
      const alice = await pilot();
      await expectFields(await page(alice, '/api/devices', { body: { name: '' } }), ['publicKey', 'name', 'proof']);
      await expectEnvelope(await page(undefined, '/api/devices', { body: newDeviceSide().request() }), 401, 'auth.required');
    });
  });

  describe('GET /api/devices/pending/:shortId', () => {
    it('gives the approver the pending Appareil’s name, public key and proof', async () => {
      const alice = await pilot();
      const { side, created } = await register(alice);

      const res = await page(alice, `/api/devices/pending/${created.shortId}`);

      expect(res.status).toBe(200);
      expect(zPendingDevice.parse(await res.json())).toEqual({ ...created, name: 'Safari sur iPhone', publicKey: side.publicKey, proof: side.request().proof });
    });

    it('answers 404 devices.code-unknown to an unknown, expired or another Pilote’s code, 401 without a session', async () => {
      const alice = await pilot('alice');
      const bob = await pilot('bob');
      const now = Date.parse('2026-11-11T08:00:00.000Z');
      clock.now = () => new Date(now);
      const { created } = await register(alice);

      await expectEnvelope(await page(bob, `/api/devices/pending/${created.shortId}`), 404, 'devices.code-unknown');
      await expectEnvelope(await page(alice, '/api/devices/pending/UUUU'), 404, 'devices.code-unknown');
      await expectEnvelope(await page(undefined, `/api/devices/pending/${created.shortId}`), 401, 'auth.required');
      clock.now = () => new Date(now + DEVICE_CODE_TTL_SECONDS * 1000);
      await expectEnvelope(await page(alice, `/api/devices/pending/${created.shortId}`), 404, 'devices.code-unknown');
    });
  });

  describe('POST /api/devices/:id/approve', () => {
    it('makes the Appareil trusted with its wrap; the new page then reads its wrap and who approved it', async () => {
      const alice = await pilot();
      const first = await linked(alice);
      const { side, created } = await register(alice);
      const body = approval(side, { type: 'device', id: first.deviceId, publicKey: first.sides.devicePublicKey });

      const res = await page(alice, `/api/devices/${created.id}/approve`, { body, deviceId: first.deviceId });

      expect(res.status).toBe(200);
      expect(zDevice.parse(await res.json())).toMatchObject({ id: created.id, state: 'trusted', name: 'Safari sur iPhone' });
      expect((await events(alice.id)).at(-1)).toMatchObject({ id: created.id, state: 'trusted' });
      const wrap = await page(alice, `/api/devices/${created.id}/vault-key-wrap`, { deviceId: created.id });
      expect(zVaultKeyWrap.parse(await wrap.json())).toEqual({ vaultKeyVersion: 1, ...body.wrap });
      const approved = await page(alice, `/api/devices/${created.id}/approval`, { deviceId: created.id });
      expect(zDeviceApproval.parse(await approved.json())).toEqual({
        approver: { type: 'device', id: first.deviceId, publicKey: first.sides.devicePublicKey },
        proof: body.proof,
      });
    });

    it('answers 409 devices.not-pending to a code already used or expired', async () => {
      const alice = await pilot();
      const first = await linked(alice);
      const approver = { type: 'device', id: first.deviceId, publicKey: first.sides.devicePublicKey } as const;
      const now = Date.parse('2026-11-11T08:00:00.000Z');
      clock.now = () => new Date(now);
      const used = await register(alice);
      const expired = await register(alice);
      expect((await page(alice, `/api/devices/${used.created.id}/approve`, { body: approval(used.side, approver), deviceId: first.deviceId })).status).toBe(200);

      await expectEnvelope(await page(alice, `/api/devices/${used.created.id}/approve`, { body: approval(used.side, approver), deviceId: first.deviceId }), 409, 'devices.not-pending');
      clock.now = () => new Date(now + DEVICE_CODE_TTL_SECONDS * 1000);
      await expectEnvelope(
        await page(alice, `/api/devices/${expired.created.id}/approve`, { body: approval(expired.side, approver), deviceId: first.deviceId }),
        409,
        'devices.not-pending',
      );
    });

    it('answers 422 devices.not-trusted when the page’s Appareil is not the trusted approver it names', async () => {
      const alice = await pilot();
      const first = await linked(alice);
      const other = await register(alice);
      const { side, created } = await register(alice);
      const body = approval(side, { type: 'device', id: first.deviceId, publicKey: first.sides.devicePublicKey });

      await expectEnvelope(await page(alice, `/api/devices/${created.id}/approve`, { body }), 422, 'devices.not-trusted');
      await expectEnvelope(await page(alice, `/api/devices/${created.id}/approve`, { body, deviceId: other.created.id }), 422, 'devices.not-trusted');
      await expectEnvelope(
        await page(alice, `/api/devices/${created.id}/approve`, { body: { ...body, approver: { type: 'device', id: other.created.id } }, deviceId: other.created.id }),
        422,
        'devices.not-trusted',
      );
      await expectEnvelope(
        await page(alice, `/api/devices/${created.id}/approve`, { body: { ...body, approver: { type: 'runner', id: first.runnerId } }, deviceId: first.deviceId }),
        422,
        'devices.not-trusted',
      );
      expect((await sql<{ state: string }>('SELECT state FROM devices WHERE id = $1', [created.id]))[0]?.state).toBe('pending');
    });

    it('answers 422 devices.approval-invalid to a wrap of another version of the vault key', async () => {
      const alice = await pilot();
      const first = await linked(alice);
      const { side, created } = await register(alice);
      const body = approval(side, { type: 'device', id: first.deviceId, publicKey: first.sides.devicePublicKey }, 2);

      await expectEnvelope(await page(alice, `/api/devices/${created.id}/approve`, { body, deviceId: first.deviceId }), 422, 'devices.approval-invalid');
    });

    it('answers 404 devices.not-found to another Pilote’s Appareil, 400 with the fields, 401 without a session', async () => {
      const alice = await pilot('alice');
      const bob = await pilot('bob');
      const first = await linked(alice);
      const bobs = await register(bob);
      const body = approval(bobs.side, { type: 'device', id: first.deviceId, publicKey: first.sides.devicePublicKey });

      await expectEnvelope(await page(alice, `/api/devices/${bobs.created.id}/approve`, { body, deviceId: first.deviceId }), 404, 'devices.not-found');
      await expectEnvelope(await page(alice, '/api/devices/pas-un-id/approve', { body, deviceId: first.deviceId }), 404, 'devices.not-found');
      await expectFields(await page(alice, `/api/devices/${bobs.created.id}/approve`, { body: { approver: { type: 'device' } }, deviceId: first.deviceId }), [
        'approver.id',
        'vaultKeyVersion',
        'wrap',
        'proof',
      ]);
      await expectEnvelope(await page(undefined, `/api/devices/${bobs.created.id}/approve`, { body }), 401, 'auth.required');
    });
  });

  describe('GET /api/devices/:id/approval', () => {
    it('answers 404 devices.not-found to an Appareil no code approved, or another Pilote’s', async () => {
      const alice = await pilot('alice');
      const bob = await pilot('bob');
      const first = await linked(alice);
      const { created } = await register(alice);

      await expectEnvelope(await page(alice, `/api/devices/${first.deviceId}/approval`), 404, 'devices.not-found');
      await expectEnvelope(await page(alice, `/api/devices/${created.id}/approval`), 404, 'devices.not-found');
      await expectEnvelope(await page(bob, `/api/devices/${first.deviceId}/approval`), 404, 'devices.not-found');
      await expectEnvelope(await page(undefined, `/api/devices/${created.id}/approval`), 401, 'auth.required');
    });
  });

  describe('the Runner’s routes (its token)', () => {
    it('reads the pending Appareil and approves it with its own public key', async () => {
      const alice = await pilot();
      const first = await linked(alice);
      const { side, created } = await register(alice);

      const pending = await binary(`/api/runner/devices/pending/${created.shortId}`, { token: first.token });
      expect(zPendingDevice.parse(await pending.json())).toMatchObject({ id: created.id, publicKey: side.publicKey });
      const body = approval(side, { type: 'runner', id: first.runnerId, publicKey: first.sides.runnerPublicKey });
      const res = await binary(`/api/runner/devices/${created.id}/approve`, { body, token: first.token });

      expect(res.status).toBe(200);
      expect(zDevice.parse(await res.json())).toMatchObject({ id: created.id, state: 'trusted' });
      const approved = zDeviceApproval.parse(await (await page(alice, `/api/devices/${created.id}/approval`)).json());
      expect(approved.approver).toEqual({ type: 'runner', id: first.runnerId, publicKey: first.sides.runnerPublicKey });
    });

    it('answers 401 runner.token-invalid without a token, with an unknown one or a session only', async () => {
      const alice = await pilot();
      const first = await linked(alice);
      const { created } = await register(alice);
      const path = `/api/runner/devices/pending/${created.shortId}`;

      await expectEnvelope(await binary(path), 401, 'runner.token-invalid');
      await expectEnvelope(await binary(path, { token: 'pas-un-jeton' }), 401, 'runner.token-invalid');
      await expectEnvelope(await page(alice, path, { deviceId: first.deviceId }), 401, 'runner.token-invalid');
    });

    it('answers 422 devices.not-trusted when the approver is not the token’s Runner, 404 to another Pilote’s Appareil', async () => {
      const alice = await pilot('alice');
      const bob = await pilot('bob');
      const first = await linked(alice);
      const { side, created } = await register(alice);
      const bobs = await register(bob);
      const body = approval(side, { type: 'runner', id: first.runnerId, publicKey: first.sides.runnerPublicKey });

      await expectEnvelope(await binary(`/api/runner/devices/${created.id}/approve`, { body: { ...body, approver: { type: 'runner', id: newId() } }, token: first.token }), 422, 'devices.not-trusted');
      await expectEnvelope(await binary(`/api/runner/devices/${created.id}/approve`, { body: { ...body, approver: { type: 'device', id: first.deviceId } }, token: first.token }), 422, 'devices.not-trusted');
      await expectEnvelope(await binary(`/api/runner/devices/pending/${bobs.created.shortId}`, { token: first.token }), 404, 'devices.code-unknown');
      await expectEnvelope(await binary(`/api/runner/devices/${bobs.created.id}/approve`, { body, token: first.token }), 404, 'devices.not-found');
    });
  });
});
