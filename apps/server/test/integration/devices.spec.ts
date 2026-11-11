import { DEVICE_HEADER, zDeviceList, zVaultKeyWrap } from '@crewdeck/contracts';
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
import { pairingSides } from '../fakes/pairing.js';
import { expectEnvelope, startApp } from '../route-baseline.js';

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

describe('the Appareils against PostgreSQL', () => {
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

  const binary = (path: string, body?: unknown): Promise<Response> =>
    fetch(`${url}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

  const seq = async (tab: Tab): Promise<number> => ((await (await page(tab, '/api/state')).json()) as { seq: number }).seq;

  /** A new Appareil of `tab`'s Pilote: `pending`, or `trusted` once it linked the first Runner. */
  const device = async (tab: Tab, { trusted = false } = {}) => {
    const sides = pairingSides();
    const res = await page(tab, '/api/runner/link-codes', { body: { pairing: sides.browser() } });
    const code = (await res.json()) as { id: string; shortId: string; deviceId: string };
    if (trusted) {
      const accepted = (await (await binary('/api/runner/link', { ...MACHINE, shortId: code.shortId })).json()) as { linkId: string };
      await binary(`/api/runner/link/${accepted.linkId}/pairing`, { pairing: sides.runner(code.shortId) });
      const confirmed = await page(tab, `/api/runner/link-codes/${code.id}/confirm`, { body: { pairing: sides.confirm(code.shortId), seq: await seq(tab) } });
      expect(confirmed.status).toBe(200);
    }
    return { id: code.deviceId, sides };
  };

  describe('GET /api/devices', () => {
    it('lists the Pilote’s Appareils newest first, current the one the page names', async () => {
      const alice = await pilot();
      const first = await device(alice, { trusted: true });
      const second = await device(alice);

      const res = await page(alice, '/api/devices', { deviceId: second.id });

      expect(res.status).toBe(200);
      const { items } = zDeviceList.parse(await res.json());
      expect(items.map(({ id, state, current }) => ({ id, state, current }))).toEqual([
        { id: second.id, state: 'pending', current: true },
        { id: first.id, state: 'trusted', current: false },
      ]);
      expect(items[0]).toMatchObject({ name: 'Chrome sur Linux', approvedAt: null, revokedAt: null });
    });

    it('lists none of another Pilote’s Appareils; 401 without a session', async () => {
      const alice = await pilot('alice');
      const bob = await pilot('bob');
      await device(alice);

      expect(zDeviceList.parse(await (await page(bob, '/api/devices')).json()).items).toEqual([]);
      await expectEnvelope(await page(undefined, '/api/devices'), 401, 'auth.required');
    });
  });

  describe('GET /api/devices/:id/vault-key-wrap', () => {
    it('gives a trusted Appareil its wrap of the current vault key', async () => {
      const alice = await pilot();
      const trusted = await device(alice, { trusted: true });

      const res = await page(alice, `/api/devices/${trusted.id}/vault-key-wrap`);

      expect(res.status).toBe(200);
      const { deviceVaultWrap } = trusted.sides.confirm('XXXX');
      expect(zVaultKeyWrap.parse(await res.json())).toEqual({ vaultKeyVersion: 1, ...deviceVaultWrap });
    });

    it('answers 422 devices.not-trusted to a pending Appareil, 422 devices.revoked to a revoked one', async () => {
      const alice = await pilot();
      await device(alice, { trusted: true });
      const pending = await device(alice);
      const revoked = await device(alice);
      await sql(`UPDATE devices SET state = 'revoked', revoked_at = now() WHERE id = $1`, [revoked.id]);

      await expectEnvelope(await page(alice, `/api/devices/${pending.id}/vault-key-wrap`), 422, 'devices.not-trusted');
      await expectEnvelope(await page(alice, `/api/devices/${revoked.id}/vault-key-wrap`), 422, 'devices.revoked');
    });

    it('answers 404 devices.not-found to another Pilote’s Appareil or an id that is none, 401 without a session', async () => {
      const alice = await pilot('alice');
      const bob = await pilot('bob');
      const trusted = await device(alice, { trusted: true });

      await expectEnvelope(await page(bob, `/api/devices/${trusted.id}/vault-key-wrap`), 404, 'devices.not-found');
      await expectEnvelope(await page(alice, '/api/devices/pas-un-id/vault-key-wrap'), 404, 'devices.not-found');
      await expectEnvelope(await page(alice, `/api/devices/${newId()}/vault-key-wrap`), 404, 'devices.not-found');
      await expectEnvelope(await page(undefined, `/api/devices/${trusted.id}/vault-key-wrap`), 401, 'auth.required');
    });
  });

  describe(`${DEVICE_HEADER}`, () => {
    const lastSeen = async (id: string) => (await sql<{ last_seen_at: Date | null }>('SELECT last_seen_at FROM devices WHERE id = $1', [id]))[0]?.last_seen_at;
    const seenEvents = async (pilotId: string) =>
      (await sql<{ payload: { lastSeenAt: string | null } }>(`SELECT payload FROM events WHERE pilot_id = $1 AND type = 'device.upserted' ORDER BY seq`, [pilotId])).map(
        (row) => row.payload.lastSeenAt,
      );

    it('moves lastSeenAt at most once an hour (fake clock), with device.upserted', async () => {
      const alice = await pilot();
      const { id } = await device(alice);
      const start = Date.parse('2026-11-11T08:00:00.000Z');
      clock.now = () => new Date(start);

      await page(alice, '/api/state', { deviceId: id });
      clock.now = () => new Date(start + 59 * 60 * 1000);
      await page(alice, '/api/state', { deviceId: id });
      expect((await lastSeen(id))?.toISOString()).toBe('2026-11-11T08:00:00.000Z');

      clock.now = () => new Date(start + 60 * 60 * 1000);
      await page(alice, '/api/state', { deviceId: id });

      expect((await lastSeen(id))?.toISOString()).toBe('2026-11-11T09:00:00.000Z');
      expect(await seenEvents(alice.id)).toEqual([null, '2026-11-11T08:00:00.000Z', '2026-11-11T09:00:00.000Z']);
    });

    it('moves nothing for another Pilote’s Appareil, a revoked one, or no session', async () => {
      const alice = await pilot('alice');
      const bob = await pilot('bob');
      const { id } = await device(alice);
      const revoked = await device(alice);
      await sql(`UPDATE devices SET state = 'revoked' WHERE id = $1`, [revoked.id]);

      await page(bob, '/api/state', { deviceId: id });
      await page(alice, '/api/state', { deviceId: revoked.id });
      await page(undefined, '/api/health', { deviceId: id });

      expect(await lastSeen(id)).toBeNull();
      expect(await lastSeen(revoked.id)).toBeNull();
    });
  });
});
