import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEVICE_HEADER, zRunnerLinkCodeCreated, zRunnerLinkConfirmed, zState, zVaultKeyWrap } from '@crewdeck/contracts';
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
import { RUNNER_DIR, buildRunner, memoryDevices, recordingProxy, run, webKeys, type WebKeys } from '../runner-binary.js';

/**
 * The first Appareil end to end (E2E-2): the real `crewdeck-runner link`,
 * built from apps/runner, links against this server while the page's side is
 * the web's own pairing and vault code (apps/web/src/keys/, WebCrypto in Node).
 * Then the Runner opens its vault from its files as `run` does at start
 * (TestVaultProbe), and an item crosses each way. Needs `go` on the PATH (CI's
 * setup installs it with mise).
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

/** Every request the page and the binary send, as text: none may carry the secret nor the vault key. */
const sent: string[] = [];

describe('the first Appareil, the Go Runner against the server (E2E-2)', () => {
  let app: INestApplication;
  let url: string;
  let proxy: { server: Server; url: string };
  let work: string;
  let binaryPath: string;
  let probePath: string;
  let keys: WebKeys;

  beforeAll(async () => {
    ({ app, url } = await startApp(env));
    proxy = await recordingProxy(url, sent);
    keys = await webKeys();
    work = await mkdtemp(join(tmpdir(), 'crewdeck-first-appareil-'));
    binaryPath = await buildRunner(work);
    probePath = join(work, 'probe.test');
    await run('go', ['test', '-c', '-o', probePath, './cmd/crewdeck-runner'], { cwd: RUNNER_DIR });
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

  const pilot = async (): Promise<{ id: string; cookie: string }> => {
    const id = newId();
    await sql(`INSERT INTO pilots (id, github_user_id, login, time_zone, getting_started_step) VALUES ($1, $2, 'octocat', 'Europe/Paris', 'runner')`, [
      id,
      Math.floor(Math.random() * 1e9),
    ]);
    const prisma = app.get(PrismaService);
    const token = await runInPilotScope(id, () => app.get(WebSessions).open(prisma.scoped, id, undefined));
    return { id, cookie: `${SESSION_COOKIE}=${token}` };
  };

  it('links with the real binary and the web’s pairing: one vault key, opened by the page and by the Runner after its restart, items both ways', async () => {
    const tab = await pilot();
    /** The page's Appareil, in `X-Crewdeck-Device` once the server named it. */
    const current: { deviceId?: string } = {};
    const page = (path: string, body?: unknown): Promise<Response> => {
      const text = body === undefined ? undefined : JSON.stringify(body);
      sent.push(`${body === undefined ? 'GET' : 'POST'} ${path} ${text ?? ''}`);
      return fetch(`${url}${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { cookie: tab.cookie, origin: ORIGIN, 'content-type': 'application/json', ...(current.deviceId ? { [DEVICE_HEADER]: current.deviceId } : {}) },
        ...(text === undefined ? {} : { body: text }),
      });
    };
    const state = async () => zState.parse(await (await page('/api/state')).json());

    // The page: its Appareil, its vault, the code's secret that stays in it.
    const devices = memoryDevices();
    const vault = keys.createVault({
      devices,
      fetchWrap: async (id) => {
        const res = await page(`/api/devices/${id}/vault-key-wrap`);
        if (!res.ok) throw Object.assign(new Error('wrap'), (await res.json()) as object);
        return zVaultKeyWrap.parse(await res.json());
      },
    });
    const linkKeys = keys.createLinkKeys({ devices, vault, userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36' });
    const secretBytes = crypto.getRandomValues(new Uint8Array(16));
    const secret = keys.encodeBase32(secretBytes);
    const created = await page('/api/runner/link-codes', { pairing: await linkKeys.browserPairing() });
    expect(created.status).toBe(201);
    const code = zRunnerLinkCodeCreated.parse(await created.json());
    await linkKeys.adoptDevice(code.deviceId);
    current.deviceId = code.deviceId;

    // The Runner: the command the page gives, run on this machine.
    const home = join(work, 'home');
    const linking = run(binaryPath, ['link', '--server', proxy.url, '--no-service', `${code.shortId}-${secret}`], {
      env: { ...process.env, CREWDECK_HOME: home, PATH: `${work}:${process.env['PATH'] ?? ''}` },
    });

    // The page answers once the Runner is pending with its pairing.
    let pending: Awaited<ReturnType<typeof state>>['runner-link'] = null;
    for (let tries = 0; tries < 100 && !pending?.runnerPairing; tries++) {
      await new Promise((done) => setTimeout(done, 100));
      pending = (await state())['runner-link'];
    }
    if (!pending?.runnerPairing || !pending.runnerId) throw new Error(`the Runner never paired: ${JSON.stringify(pending)}`);
    const pairing = await linkKeys.confirmPairing({ secret, shortId: code.shortId, runnerId: pending.runnerId, runnerPairing: pending.runnerPairing });
    expect(pairing).not.toBeNull();
    const confirmed = await page(`/api/runner/link-codes/${code.id}/confirm`, { pairing, seq: (await state()).seq });
    expect(confirmed.status).toBe(200);
    const { runner } = zRunnerLinkConfirmed.parse(await confirmed.json());

    const { stdout } = await linking;
    expect(stdout).toContain('Runner relié à ton compte.');

    // A trusted Appareil, a Runner, two wraps of version 1.
    const after = await state();
    expect(after.devices).toEqual([expect.objectContaining({ id: code.deviceId, state: 'trusted' })]);
    expect(after.runner).toMatchObject({ id: runner.id });
    expect(
      await sql('SELECT holder_type, holder_id, vault_key_version FROM vault_key_wraps WHERE pilot_id = $1 ORDER BY holder_type', [tab.id]),
    ).toEqual([
      { holder_type: 'device', holder_id: code.deviceId, vault_key_version: 1 },
      { holder_type: 'runner', holder_id: runner.id, vault_key_version: 1 },
    ]);

    // The page opens its own wrap; the Runner, restarted, opens its own: an item crosses each way.
    expect(await vault.unlockVault()).toBe('unlocked');
    expect(vault.version()).toBe(1);
    const encoder = new TextEncoder();
    const fromPage = await vault.sealItem(encoder.encode('une Idée du navigateur'), encoder.encode('idea_1:text'));
    const probe = join(work, 'probe');
    await mkdir(probe, { recursive: true });
    await writeFile(
      join(probe, 'in.json'),
      JSON.stringify({
        fromPage: { aad: 'idea_1:text', key: keys.toBase64Url(fromPage.key), ciphertext: keys.toBase64Url(fromPage.ciphertext) },
        toPage: { aad: 'session_1:summary', plaintext: 'le résumé du Runner' },
      }),
    );
    await run(probePath, ['-test.run', '^TestVaultProbe$', '-test.count', '1'], { env: { ...process.env, CREWDECK_HOME: home, CREWDECK_VAULT_PROBE: probe } });
    const out = JSON.parse(await readFile(join(probe, 'out.json'), 'utf8')) as { opened: string; sealed: { aad: string; key: string; ciphertext: string } };
    expect(out.opened).toBe('une Idée du navigateur');
    const fromRunner = await vault.openItem({ key: keys.fromBase64Url(out.sealed.key), ciphertext: keys.fromBase64Url(out.sealed.ciphertext) }, encoder.encode('session_1:summary'));
    expect(new TextDecoder().decode(fromRunner)).toBe('le résumé du Runner');

    // Neither the secret nor the vault key in a request, a column or the Runner's files.
    const vaultKey = await vault.rawVaultKeyForWrap();
    const leaks = [
      secret,
      secret.toLowerCase(),
      keys.toBase64Url(secretBytes),
      Buffer.from(secretBytes).toString('base64'),
      Buffer.from(secretBytes).toString('hex'),
      keys.toBase64Url(vaultKey),
      Buffer.from(vaultKey).toString('base64'),
      Buffer.from(vaultKey).toString('hex'),
    ];
    const tables = await sql<{ tablename: string }>("SELECT tablename FROM pg_tables WHERE schemaname = 'public'");
    const columns = (await Promise.all(tables.map(({ tablename }) => sql<{ row: string }>(`SELECT row_to_json(t)::text AS row FROM "${tablename}" t`))))
      .flat()
      .map(({ row }) => row)
      .join('\n');
    const files = (await Promise.all((await readdir(home)).map((name) => readFile(join(home, name), 'utf8')))).join('\n');
    expect(sent.some((request) => request.startsWith('POST /api/runner/link/') && request.includes('/pairing'))).toBe(true);
    for (const leak of leaks) {
      expect(sent.join('\n')).not.toContain(leak);
      expect(columns).not.toContain(leak);
      expect(files).not.toContain(leak);
    }
  }, 120_000);
});
