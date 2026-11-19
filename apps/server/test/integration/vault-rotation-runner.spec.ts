import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DEVICE_HEADER,
  ideaItemAad,
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
import { buildRunner, memoryDevices, run, webKeys, type ApprovalApi, type DeviceStore, type WebKeys } from '../runner-binary.js';

/**
 * The Runner rotates the vault key when it is the first holder online
 * (E2E-4): the first Appareil links the real `crewdeck-runner`, which
 * approves a phone; the phone revokes the first Appareil; `crewdeck-runner
 * run` reads the rotation pending in its `hello.accepted`, rewraps the item
 * keys and wraps the new key for the phone and itself. The phone, with the
 * web's own keys, opens the new version and the Idée sealed before. Needs
 * `go` on the PATH.
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

describe('the vault key rotated by the Go Runner (E2E-4)', () => {
  let app: INestApplication;
  let url: string;
  let work: string;
  let binaryPath: string;
  let keys: WebKeys;

  beforeAll(async () => {
    ({ app, url } = await startApp(env));
    keys = await webKeys();
    work = await mkdtemp(join(tmpdir(), 'crewdeck-rotation-'));
    binaryPath = await buildRunner(work);
  }, 180_000);

  afterAll(async () => {
    await sql('TRUNCATE pilots CASCADE');
    await app.close();
    await rm(work, { recursive: true, force: true });
  });

  /** A browser of the Pilote: its own session, its Appareil in memory, its vault. */
  const browser = async (pilotId: string, userAgent: string, devices: DeviceStore = memoryDevices()) => {
    const prisma = app.get(PrismaService);
    const cookie = `${SESSION_COOKIE}=${await runInPilotScope(pilotId, () => app.get(WebSessions).open(prisma.scoped, pilotId, undefined))}`;
    const current: { deviceId?: string } = {};
    const call = async (method: 'GET' | 'POST', path: string, body?: object): Promise<unknown> => {
      const res = await fetch(`${url}${path}`, {
        method,
        headers: { cookie, origin: ORIGIN, 'content-type': 'application/json', ...(current.deviceId ? { [DEVICE_HEADER]: current.deviceId } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const json: unknown = await res.json();
      if (!res.ok) throw Object.assign(new Error(`${method} ${path} ${res.status}`), { status: res.status }, json as object);
      return json;
    };
    const vault = keys.createVault({ devices, fetchWrap: async (id) => zVaultKeyWrap.parse(await call('GET', `/api/devices/${id}/vault-key-wrap`)) });
    const api: ApprovalApi = {
      register: async (request: NewDeviceRequest) => zDeviceCreated.parse(await call('POST', '/api/devices', request)),
      pending: async (shortId) => zPendingDevice.parse(await call('GET', `/api/devices/pending/${shortId}`)),
      approve: async (id, body: ApproveDevice) => zDevice.parse(await call('POST', `/api/devices/${id}/approve`, body)),
      approval: async (id) => zDeviceApproval.parse(await call('GET', `/api/devices/${id}/approval`)),
    };
    return { current, call, devices, vault, approval: keys.createDeviceApproval({ devices, vault, api, userAgent }), linkKeys: keys.createLinkKeys({ devices, vault, userAgent }) };
  };

  it('rotates when it is the first holder online: the phone opens version 2 and the Idée sealed before; the revoked Appareil gets no wrap', async () => {
    const pilotId = newId();
    await sql(`INSERT INTO pilots (id, github_user_id, login, time_zone, getting_started_step) VALUES ($1, $2, 'octocat', 'Europe/Paris', 'runner')`, [
      pilotId,
      Math.floor(Math.random() * 1e9),
    ]);

    // The first Appareil links the Runner (E2E-2) and seals an Idée's text.
    const first = await browser(pilotId, CHROME);
    const state = async () => zState.parse(await first.call('GET', '/api/state'));
    const linkSecret = keys.encodeBase32(crypto.getRandomValues(new Uint8Array(16)));
    const link = zRunnerLinkCodeCreated.parse(await first.call('POST', '/api/runner/link-codes', { pairing: await first.linkKeys.browserPairing() }));
    await first.linkKeys.adoptDevice(link.deviceId);
    first.current.deviceId = link.deviceId;
    const home = join(work, 'home');
    const runnerEnv = { ...process.env, CREWDECK_HOME: home, PATH: `${work}:${process.env['PATH'] ?? ''}` };
    const linking = run(binaryPath, ['link', '--server', url, '--no-service', `${link.shortId}-${linkSecret}`], { env: runnerEnv });
    let pending: Awaited<ReturnType<typeof state>>['runner-link'] = null;
    for (let tries = 0; tries < 100 && !pending?.runnerPairing; tries++) {
      await new Promise((done) => setTimeout(done, 100));
      pending = (await state())['runner-link'];
    }
    if (!pending?.runnerPairing || !pending.runnerId) throw new Error(`the Runner never paired: ${JSON.stringify(pending)}`);
    const runnerId = pending.runnerId;
    const pairing = await first.linkKeys.confirmPairing({ secret: linkSecret, shortId: link.shortId, runnerId, runnerPairing: pending.runnerPairing });
    await first.call('POST', `/api/runner/link-codes/${link.id}/confirm`, { pairing, seq: (await state()).seq });
    await linking;
    expect(await first.vault.unlockVault()).toBe('unlocked');
    const encoder = new TextEncoder();
    const ideaId = newId();
    const sealed = await first.vault.sealItem(encoder.encode('le texte d’une Idée'), encoder.encode(ideaItemAad(ideaId, 'text')));
    await sql(`INSERT INTO ideas (id, pilot_id, number, state, text, noted_from, created_at, updated_at) VALUES ($1, $2, 1, 'to-triage', $3, 'pc', now(), now())`, [
      ideaId,
      pilotId,
      JSON.stringify({ key: keys.toBase64Url(sealed.key), ciphertext: keys.toBase64Url(sealed.ciphertext) }),
    ]);

    // The Runner approves the phone (E2E-3): it authenticates the phone's key, so it may wrap for it.
    const phoneDevices = memoryDevices();
    const phone = await browser(pilotId, SAFARI_IOS, phoneDevices);
    const code = await phone.approval.register();
    const approving = run(binaryPath, ['appareils', 'approuver', '--server', url, keys.deviceCodeText(code)], { env: runnerEnv });
    approving.child.stdin?.end('o\n');
    await approving;
    expect(await phone.approval.adopt(code)).toBe('approved');
    phone.current.deviceId = code.id;
    expect(await phone.vault.unlockVault()).toBe('unlocked');

    // The phone revokes the first Appareil: its wrap refused at once, the rotation pending.
    await phone.call('POST', `/api/devices/${link.deviceId}/revoke`, { seq: (await state()).seq });
    await expect(first.call('GET', `/api/devices/${link.deviceId}/vault-key-wrap`)).rejects.toMatchObject({ status: 422, code: 'devices.revoked' });
    expect((await state()).vault).toEqual({ version: 1, rotationPending: true });

    // The Runner comes online, the first holder there: it rotates.
    const runner = spawn(binaryPath, ['run', '--server', url], { env: runnerEnv, stdio: ['ignore', 'pipe', 'pipe'] });
    let logs = '';
    runner.stdout.on('data', (chunk: Buffer) => (logs += chunk.toString('utf8')));
    runner.stderr.on('data', (chunk: Buffer) => (logs += chunk.toString('utf8')));
    try {
      let version = 1;
      for (let tries = 0; tries < 300 && version !== 2; tries++) {
        await new Promise((done) => setTimeout(done, 100));
        const [row] = await sql<{ vault_key_version: number; vault_rotation_pending: boolean }>('SELECT vault_key_version, vault_rotation_pending FROM pilots WHERE id = $1', [pilotId]);
        version = row?.vault_key_version ?? 1;
      }
      if (version !== 2) throw new Error(`the Runner never rotated: ${logs}`);
    } finally {
      runner.kill('SIGTERM');
      await new Promise((done) => runner.once('exit', done));
    }

    expect((await state()).vault).toEqual({ version: 2, rotationPending: false });
    expect(await sql('SELECT holder_type, holder_id, vault_key_version FROM vault_key_wraps WHERE pilot_id = $1 ORDER BY holder_type', [pilotId])).toEqual([
      { holder_type: 'device', holder_id: code.id, vault_key_version: 2 },
      { holder_type: 'runner', holder_id: runnerId, vault_key_version: 2 },
    ]);
    const [idea] = await sql<{ text: { key: string; ciphertext: string } }>('SELECT text FROM ideas WHERE id = $1', [ideaId]);
    expect(idea?.text.ciphertext).toBe(keys.toBase64Url(sealed.ciphertext));
    expect(idea?.text.key).not.toBe(keys.toBase64Url(sealed.key));

    // The phone, reloaded, opens version 2 from the Runner's key and the Idée sealed before.
    const reloaded = await browser(pilotId, SAFARI_IOS, phoneDevices);
    reloaded.current.deviceId = code.id;
    expect(await reloaded.vault.unlockVault()).toBe('unlocked');
    expect(reloaded.vault.version()).toBe(2);
    const rewrapped = { key: keys.fromBase64Url(idea?.text.key ?? ''), ciphertext: keys.fromBase64Url(idea?.text.ciphertext ?? '') };
    expect(new TextDecoder().decode(await reloaded.vault.openItem(rewrapped, encoder.encode(ideaItemAad(ideaId, 'text'))))).toBe('le texte d’une Idée');
    // The old item key no longer opens under the new vault key.
    await expect(reloaded.vault.openItem(sealed, encoder.encode(ideaItemAad(ideaId, 'text')))).rejects.toThrow();
  }, 120_000);
});
