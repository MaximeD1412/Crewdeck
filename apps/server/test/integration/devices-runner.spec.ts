import { mkdtemp, rm } from 'node:fs/promises';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DEVICE_HEADER,
  zDevice,
  zDeviceApproval,
  zDeviceCreated,
  zPendingDevice,
  zRunnerLinkCodeCreated,
  zState,
  zVaultKeyWrap,
  type ApproveDevice,
  type NewDeviceRequest,
} from '@crewdeck/contracts';
import type { INestApplication } from '@nestjs/common';
import pg from 'pg';
import { inject } from 'vitest';
import { SESSION_COOKIE } from '../../src/auth/cookies.js';
import { WebSessions } from '../../src/auth/web-sessions.js';
import { appOrigin, parseEnv } from '../../src/config/env.js';
import { newId } from '../../src/ids.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { runInPilotScope } from '../../src/scope/scope.context.js';
import { startApp } from '../route-baseline.js';
import { buildRunner, memoryDevices, recordingProxy, run, webKeys, type ApprovalApi, type WebKeys } from '../runner-binary.js';

/**
 * A new Appareil approved from the machine (E2E-3): the Runner linked with
 * the real `crewdeck-runner link`, then `crewdeck-runner appareils approuver
 * <code>` approves the code a second browser shows, which opens the vault with
 * the web's own keys (apps/web/src/keys/approval.ts). Needs `go` on the PATH.
 */

const databaseUrl = inject('databaseUrl');
const env = parseEnv({ CREWDECK_ENV: 'test', DATABASE_URL: databaseUrl, CREWDECK_COMMIT: 'abc1234' });
const ORIGIN = appOrigin(env);
const CHROME = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36';
const SAFARI_IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

const sql = async <T extends pg.QueryResultRow>(text: string, values: unknown[] = []): Promise<T[]> => {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    return (await client.query<T>(text, values)).rows;
  } finally {
    await client.end();
  }
};

/** Every request the pages and the binary send, as text: none may carry the code's secret. */
const sent: string[] = [];

describe('a new Appareil approved by the Go Runner (E2E-3)', () => {
  let app: INestApplication;
  let url: string;
  let proxy: { server: Server; url: string };
  let work: string;
  let binaryPath: string;
  let keys: WebKeys;

  beforeAll(async () => {
    ({ app, url } = await startApp(env));
    proxy = await recordingProxy(url, sent);
    keys = await webKeys();
    work = await mkdtemp(join(tmpdir(), 'crewdeck-new-appareil-'));
    binaryPath = await buildRunner(work);
  }, 180_000);

  afterAll(async () => {
    await sql('TRUNCATE pilots CASCADE');
    await new Promise((done) => proxy.server.close(done));
    await app.close();
    await rm(work, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await sql('TRUNCATE pilots CASCADE');
    sent.length = 0;
  });

  /** A browser of the Pilote: its own session, its Appareil in memory, its vault. */
  const browser = async (pilotId: string, userAgent: string) => {
    const prisma = app.get(PrismaService);
    const cookie = `${SESSION_COOKIE}=${await runInPilotScope(pilotId, () => app.get(WebSessions).open(prisma.scoped, pilotId, undefined))}`;
    const current: { deviceId?: string } = {};
    const call = async (method: 'GET' | 'POST', path: string, body?: object): Promise<unknown> => {
      const text = body === undefined ? undefined : JSON.stringify(body);
      sent.push(`${method} ${path} ${text ?? ''}`);
      const res = await fetch(`${url}${path}`, {
        method,
        headers: { cookie, origin: ORIGIN, 'content-type': 'application/json', ...(current.deviceId ? { [DEVICE_HEADER]: current.deviceId } : {}) },
        ...(text === undefined ? {} : { body: text }),
      });
      const json: unknown = await res.json();
      if (!res.ok) throw Object.assign(new Error(`${method} ${path} ${res.status}`), json as object);
      return json;
    };
    const devices = memoryDevices();
    const vault = keys.createVault({ devices, fetchWrap: async (id) => zVaultKeyWrap.parse(await call('GET', `/api/devices/${id}/vault-key-wrap`)) });
    const api: ApprovalApi = {
      register: async (request: NewDeviceRequest) => zDeviceCreated.parse(await call('POST', '/api/devices', request)),
      pending: async (shortId) => zPendingDevice.parse(await call('GET', `/api/devices/pending/${shortId}`)),
      approve: async (id, body: ApproveDevice) => zDevice.parse(await call('POST', `/api/devices/${id}/approve`, body)),
      approval: async (id) => zDeviceApproval.parse(await call('GET', `/api/devices/${id}/approval`)),
    };
    return { current, call, devices, vault, approval: keys.createDeviceApproval({ devices, vault, api, userAgent }), linkKeys: keys.createLinkKeys({ devices, vault, userAgent }) };
  };

  it('approves the code of a second browser with the real binary: it opens what the first one sealed', async () => {
    const pilotId = newId();
    await sql(`INSERT INTO pilots (id, github_user_id, login, time_zone, getting_started_step) VALUES ($1, $2, 'octocat', 'Europe/Paris', 'runner')`, [
      pilotId,
      Math.floor(Math.random() * 1e9),
    ]);

    // The first Appareil links the Runner (E2E-2).
    const first = await browser(pilotId, CHROME);
    const state = async () => zState.parse(await first.call('GET', '/api/state'));
    const linkSecret = keys.encodeBase32(crypto.getRandomValues(new Uint8Array(16)));
    const link = zRunnerLinkCodeCreated.parse(await first.call('POST', '/api/runner/link-codes', { pairing: await first.linkKeys.browserPairing() }));
    await first.linkKeys.adoptDevice(link.deviceId);
    first.current.deviceId = link.deviceId;
    const home = join(work, 'home');
    const runnerEnv = { ...process.env, CREWDECK_HOME: home, PATH: `${work}:${process.env['PATH'] ?? ''}` };
    const linking = run(binaryPath, ['link', '--server', proxy.url, '--no-service', `${link.shortId}-${linkSecret}`], { env: runnerEnv });
    let pending: Awaited<ReturnType<typeof state>>['runner-link'] = null;
    for (let tries = 0; tries < 100 && !pending?.runnerPairing; tries++) {
      await new Promise((done) => setTimeout(done, 100));
      pending = (await state())['runner-link'];
    }
    if (!pending?.runnerPairing || !pending.runnerId) throw new Error(`the Runner never paired: ${JSON.stringify(pending)}`);
    const pairing = await first.linkKeys.confirmPairing({ secret: linkSecret, shortId: link.shortId, runnerId: pending.runnerId, runnerPairing: pending.runnerPairing });
    await first.call('POST', `/api/runner/link-codes/${link.id}/confirm`, { pairing, seq: (await state()).seq });
    await linking;
    expect(await first.vault.unlockVault()).toBe('unlocked');
    const encoder = new TextEncoder();
    const sealed = await first.vault.sealItem(encoder.encode('le texte d’une Idée'), encoder.encode('idea_1:text'));

    // The second browser shows its code; the Pilote pastes it on the machine.
    const phone = await browser(pilotId, SAFARI_IOS);
    expect(await phone.vault.unlockVault()).toBe('no-device');
    const code = await phone.approval.register();
    const approving = run(binaryPath, ['appareils', 'approuver', '--server', proxy.url, keys.deviceCodeText(code)], { env: runnerEnv });
    approving.child.stdin?.end('o\n');
    const { stdout } = await approving;
    expect(stdout).toContain('Approuver « Safari sur iOS » ? (o/N)');
    expect(stdout).toContain('« Safari sur iOS » est approuvé');

    // Approved by the Runner, it opens its wrap from the Runner's key, checked by the code.
    expect(await phone.approval.adopt(code)).toBe('approved');
    phone.current.deviceId = code.id;
    expect(await phone.vault.unlockVault()).toBe('unlocked');
    expect(new TextDecoder().decode(await phone.vault.openItem(sealed, encoder.encode('idea_1:text')))).toBe('le texte d’une Idée');
    const devices = (await state()).devices.map(({ id, state: deviceState }) => ({ id, state: deviceState }));
    expect(devices).toEqual(expect.arrayContaining([{ id: link.deviceId, state: 'trusted' }, { id: code.id, state: 'trusted' }]));
    expect(await sql('SELECT approver_type, approver_id FROM devices WHERE id = $1', [code.id])).toEqual([{ approver_type: 'runner', approver_id: pending.runnerId }]);

    // The code's secret in no request, nor in the binary's ones.
    expect(sent.some((request) => request.startsWith('POST /api/runner/devices/') && request.includes('authorization'))).toBe(true);
    const secretBytes = keys.decodeBase32(code.secret);
    for (const leak of [code.secret, code.secret.toLowerCase(), keys.toBase64Url(secretBytes), Buffer.from(secretBytes).toString('base64'), Buffer.from(secretBytes).toString('hex')]) {
      expect(sent.join('\n')).not.toContain(leak);
    }
  }, 120_000);

  it('approves nothing from a machine not linked, and says how to link it', async () => {
    const pilotId = newId();
    await sql(`INSERT INTO pilots (id, github_user_id, login, time_zone, getting_started_step) VALUES ($1, $2, 'octocat', 'Europe/Paris', 'done')`, [
      pilotId,
      Math.floor(Math.random() * 1e9),
    ]);
    const home = join(work, 'unlinked');
    const phone = await browser(pilotId, SAFARI_IOS);
    const code = await phone.approval.register();
    // An unlinked machine: the binary says how to link it, and approves nothing.
    await expect(
      run(binaryPath, ['appareils', 'approuver', '--server', proxy.url, keys.deviceCodeText(code)], { env: { ...process.env, CREWDECK_HOME: home } }),
    ).rejects.toMatchObject({ stderr: expect.stringContaining('n’est pas relié à ton compte') });
    expect(await sql('SELECT state FROM devices WHERE id = $1', [code.id])).toEqual([{ state: 'pending' }]);
  });
});
