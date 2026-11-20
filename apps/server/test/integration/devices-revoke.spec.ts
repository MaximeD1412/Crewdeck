import { randomBytes } from 'node:crypto';
import {
  DEVICE_HEADER,
  WS_CLOSE,
  PROCESS_CREWDECK,
  PROCESS_CREWDECK_NAME,
  zDevice,
  zDeviceCreated,
  zDeviceHolders,
  zRunnerLinkStatus,
  zState,
  zVault,
  zVaultItems,
  zVaultState,
  type VaultItem,
} from '@crewdeck/contracts';
import type { INestApplication } from '@nestjs/common';
import pg from 'pg';
import { inject } from 'vitest';
import { SESSION_COOKIE } from '../../src/auth/cookies.js';
import { WebSessions } from '../../src/auth/web-sessions.js';
import { appOrigin, parseEnv } from '../../src/config/env.js';
import { Prisma } from '../../src/generated/prisma/client.js';
import { newId } from '../../src/ids.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { RunnerLinkLimiter } from '../../src/runners/link/link-limiter.js';
import { RunnerCommands } from '../../src/runners/runner-commands.service.js';
import { runInPilotScope } from '../../src/scope/scope.context.js';
import { approvalProof, newDeviceSide, pairingSides, shapedWrap } from '../fakes/pairing.js';
import { connect, type WsClient } from '../fakes/ws-client.js';
import { expectEnvelope, startApp } from '../route-baseline.js';

/**
 * Revoking an Appareil and the vault key's rotation (E2E-4,
 * `docs/security/e2e.md` « Revocation and rotation »), against PostgreSQL.
 * The wraps and item keys are shaped bytes: the crypto is proven by
 * apps/web/src/keys/rotation.spec.ts and the Runner's own tests; here, what
 * the server stores, refuses and tells.
 */

const databaseUrl = inject('databaseUrl');
const env = parseEnv({ CREWDECK_ENV: 'test', DATABASE_URL: databaseUrl, CREWDECK_COMMIT: 'abc1234' });
const ORIGIN = appOrigin(env);
const MACHINE = { machine: 'atelier', os: 'linux', arch: 'amd64', wsl: true, runnerVersion: '0.1.0', engines: ['claude'] } as const;

const sql = async <T extends pg.QueryResultRow>(text: string, values: unknown[] = []): Promise<T[]> => {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    return (await client.query<T>(text, values)).rows;
  } finally {
    await client.end();
  }
};

const b64 = (bytes: number): string => randomBytes(bytes).toString('base64url');
const sealed = () => ({ key: b64(60), ciphertext: b64(64) });
const UNREADABLE_KEY = 'AAECAwQFBgcICQoLDA0ODw';

interface Tab {
  id: string;
  cookie: string;
}

describe('revoking an Appareil and rotating the vault key against PostgreSQL', () => {
  let app: INestApplication;
  let url: string;
  let prisma: PrismaService;
  /** What the server sent the Runner, per Pilote. */
  const told: { pilotId: string; type: string; message: unknown }[] = [];

  beforeAll(async () => {
    ({ app, url } = await startApp(env));
    prisma = app.get(PrismaService);
    const commands = app.get(RunnerCommands);
    commands.send = (pilotId, message) => {
      told.push({ pilotId, type: message.type, message });
    };
  });

  afterAll(async () => {
    await sql('TRUNCATE pilots CASCADE');
    await app.close();
  });

  beforeEach(async () => {
    await sql('TRUNCATE pilots CASCADE');
    // Each test links its Runners: the limiter of `POST /api/runner/link` counts per test.
    app.get(RunnerLinkLimiter).reset();
    told.length = 0;
  });

  const pilot = async (login = 'octocat'): Promise<Tab> => {
    const id = newId();
    await sql(`WITH p AS (INSERT INTO pilots (id, display_name, time_zone, getting_started_step) VALUES ($1, $3, 'Europe/Paris', 'runner') RETURNING id) INSERT INTO pilot_identities (id, pilot_id, provider, subject, login) SELECT gen_random_uuid(), id, 'github', $2::text, $3 FROM p`, [
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
      headers: { ...(tab ? { cookie: tab.cookie } : {}), origin: ORIGIN, 'content-type': 'application/json', ...(deviceId ? { [DEVICE_HEADER]: deviceId } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

  const binary = (path: string, { body, token }: { body?: unknown; token?: string } = {}): Promise<Response> =>
    fetch(`${url}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

  const seq = async (tab: Tab): Promise<number> => ((await (await page(tab, '/api/state')).json()) as { seq: number }).seq;

  /** The first Appareil of `tab`'s Pilote, trusted, and the Runner it linked, with its token. */
  const linked = async (tab: Tab) => {
    const sides = pairingSides();
    const code = (await (await page(tab, '/api/runner/link-codes', { body: { pairing: sides.browser() } })).json()) as { id: string; shortId: string; deviceId: string };
    const accepted = (await (await binary('/api/runner/link', { body: { ...MACHINE, shortId: code.shortId } })).json()) as { linkId: string };
    await binary(`/api/runner/link/${accepted.linkId}/pairing`, { body: { pairing: sides.runner(code.shortId) } });
    const confirmed = await page(tab, `/api/runner/link-codes/${code.id}/confirm`, { body: { pairing: sides.confirm(code.shortId), seq: await seq(tab) } });
    expect(confirmed.status).toBe(200);
    const status = zRunnerLinkStatus.parse(await (await binary(`/api/runner/link/${accepted.linkId}`)).json());
    if (!status.token || !status.runnerId) throw new Error('the Runner got no token');
    return { deviceId: code.deviceId, sides, publicKey: sides.devicePublicKey, runnerId: status.runnerId, runnerPublicKey: sides.runnerPublicKey, token: status.token };
  };

  /**
   * A second Appareil of `tab`, approved by `first` (E2E-3): trusted, with its
   * wrap of version 1; with `runnerPublicKey`, the holder wrap that vouches
   * for it to the Runner too (SESSION-1).
   */
  const approved = async (tab: Tab, first: { deviceId: string; publicKey: string }, { runnerPublicKey }: { runnerPublicKey?: string } = {}) => {
    const side = newDeviceSide();
    const created = zDeviceCreated.parse(await (await page(tab, '/api/devices', { body: side.request() })).json());
    const body = {
      approver: { type: 'device', id: first.deviceId },
      vaultKeyVersion: 1,
      wrap: shapedWrap(),
      proof: approvalProof(side.secret, side.publicKey, first.publicKey),
      ...(runnerPublicKey ? { runner: { publicKey: runnerPublicKey, proof: b64(32) }, holder: shapedWrap() } : {}),
    };
    const res = await page(tab, `/api/devices/${created.id}/approve`, { body, deviceId: first.deviceId });
    expect(res.status).toBe(200);
    return { deviceId: created.id, publicKey: side.publicKey };
  };

  /** A Projet of `tab` with its version 1 holding sealed Commandes, and two Idées, one analysed. */
  const items = async (tab: Tab) => {
    const repositoryId = newId();
    const projectId = newId();
    const githubId = Math.floor(Math.random() * 1e9);
    await sql(
      `INSERT INTO repositories (id, pilot_id, installation_id, github_id, owner, name, full_name, private, default_branch, has_code, updated_at)
       VALUES ($1, $2, 61000001, $3, 'octocat', 'atelier', 'octocat/atelier', true, 'main', true, now())`,
      [repositoryId, tab.id, githubId],
    );
    await sql(
      `INSERT INTO projects (id, pilot_id, repository_id, github_repo_id, owner, name, full_name, display_name, release_branch, integration_branch, has_code, inventory_state)
       VALUES ($1, $2, $3, $4, 'octocat', 'atelier', 'octocat/atelier', 'atelier', 'main', 'develop', true, 'not-needed')`,
      [projectId, tab.id, repositoryId, githubId],
    );
    // Its Sources, as following it writes: the state reads them.
    await prisma.unscoped.artifactSource.createMany({
      data: (['ticket', 'code'] as const).map((group) => ({ id: newId(), pilotId: tab.id, projectId, group, source: 'github' as const, since: new Date() })),
    });
    const versionId = newId();
    await prisma.unscoped.processVersion.create({
      data: {
        id: versionId,
        pilotId: tab.id,
        projectId,
        number: 1,
        definition: PROCESS_CREWDECK as unknown as Prisma.InputJsonValue,
        sealed: sealed(),
        activatedAt: new Date(),
        activatedBy: 'creation',
        templateName: PROCESS_CREWDECK_NAME,
      },
    });
    const ideas = [newId(), newId()];
    await sql(`INSERT INTO ideas (id, pilot_id, number, state, text, noted_from, created_at, updated_at) VALUES ($1, $2, 1, 'to-triage', $3, 'pc', now(), now())`, [
      ideas[0],
      tab.id,
      JSON.stringify(sealed()),
    ]);
    // Analysed, and analysed again: the report of the running analysis waits for its Contrat (IDEE-2), its sentences sealed.
    await sql(
      `INSERT INTO ideas (id, pilot_id, number, state, text, analysis, analysis_pending, noted_from, created_at, updated_at) VALUES ($1, $2, 2, 'analysing', $3, $4, $5, 'pc', now(), now())`,
      [ideas[1], tab.id, JSON.stringify(sealed()), JSON.stringify(sealed()), JSON.stringify({ stepRunId: newId(), figures: { impact: 3, effort: 2, projectId: 'new', duplicateIds: [] }, sealed: sealed() })],
    );
    // A Local Projet (PROJET-6): its name sealed, rewrapped as the others.
    const localId = newId();
    await sql(
      `INSERT INTO projects (id, pilot_id, name_sealed, folder_state, release_branch, integration_branch, has_code, inventory_state)
       VALUES ($1, $2, $3, 'present', 'main', 'develop', false, 'not-needed')`,
      [localId, tab.id, JSON.stringify(sealed())],
    );
    await prisma.unscoped.artifactSource.createMany({
      data: (['ticket', 'code'] as const).map((group) => ({ id: newId(), pilotId: tab.id, projectId: localId, group, source: 'local' as const, since: new Date() })),
    });
    // A Session on its Ticket (SOURCE-2): its title sealed as the Ticket's, under the Ticket's additional data.
    const sessionId = newId();
    await sql(
      `INSERT INTO agent_sessions (id, pilot_id, project_id, role, engine, model, title_sealed, title_aad, branch, base, permission_mode, state, started_at)
       VALUES ($1, $2, $3, 'code', 'claude-code', 'claude-opus-5-5', $4, $5, 'feat/3-panier', 'develop', 'bypass', 'ended', now())`,
      [sessionId, tab.id, localId, JSON.stringify(sealed()), `ticket:${localId}:3:title`],
    );
    // Its Ticket, milestone, change of code and unreadable file (SOURCE-3): their texts sealed by the Runner under `local:<id>:<place>`.
    const local = { ticketId: newId(), milestoneId: newId(), changeId: newId(), decisionId: newId() };
    await sql(
      `INSERT INTO tickets (id, pilot_id, project_id, source, number, state, ready_mark, ready, branch_prefix, visual_review, title_sealed, labels_sealed, source_created_at, source_updated_at, updated_at)
       VALUES ($1, $2, $3, 'local', 3, 'open', true, true, 'feat', false, $4, $5, now(), now(), now())`,
      [local.ticketId, tab.id, localId, JSON.stringify(sealed()), JSON.stringify(sealed())],
    );
    await sql(
      `INSERT INTO milestones (id, pilot_id, project_id, source, number, rank, state, open_count, closed_count, title_sealed, updated_at)
       VALUES ($1, $2, $3, 'local', 1, 1, 'open', 1, 0, $4, now())`,
      [local.milestoneId, tab.id, localId, JSON.stringify(sealed())],
    );
    await sql(
      `INSERT INTO code_changes (id, pilot_id, project_id, source, number, state, base_ref, title_sealed, source_created_at, updated_at)
       VALUES ($1, $2, $3, 'local', 31, 'open', 'develop', $4, now(), now())`,
      [local.changeId, tab.id, localId, JSON.stringify(sealed())],
    );
    const path = sealed();
    await sql(
      `INSERT INTO decisions (id, pilot_id, kind, project_id, subject_type, subject_id, label, meta_parts, tone, link, params)
       VALUES ($1, $2, 'ticket.local-unreadable', $3, 'project', $4, 'Fichier de Ticket illisible', '{front matter illisible}', 'caution', $5, $6)`,
      [local.decisionId, tab.id, localId, `${localId}:${UNREADABLE_KEY}`, `/projets/${localId}`, JSON.stringify({ pathSealed: `${path.key}.${path.ciphertext}`, reason: 'front-matter' })],
    );
    return { projectId, versionId, ideas, localId, sessionId, local };
  };

  const eventsOf = async (pilotId: string, type: string) =>
    (await sql<{ payload: Record<string, unknown> }>(`SELECT payload FROM events WHERE pilot_id = $1 AND type = $2 ORDER BY seq`, [pilotId, type])).map((row) => row.payload);

  const wrapsOf = async (pilotId: string) =>
    (await sql<{ holder_type: string; holder_id: string; vault_key_version: number }>(
      'SELECT holder_type, holder_id, vault_key_version FROM vault_key_wraps WHERE pilot_id = $1 ORDER BY holder_type, holder_id, vault_key_version',
      [pilotId],
    )).map(({ holder_type, holder_id, vault_key_version }) => `${holder_type}:${holder_id}:${vault_key_version}`);

  /** Every item key, all pages, as the rotating holder reads them. */
  const allItems = async (read: (cursor?: string) => Promise<Response>): Promise<VaultItem[]> => {
    const all: VaultItem[] = [];
    let cursor: string | undefined;
    do {
      const res = await read(cursor);
      expect(res.status).toBe(200);
      const items = zVaultItems.parse(await res.json());
      all.push(...items.items);
      cursor = items.nextCursor ?? undefined;
    } while (cursor);
    return all;
  };

  /** A rotation of `vault` for each of its holders, each item rewrapped (new shaped bytes). */
  const rotationOf = (vault: { version: number; holders: { type: string; id: string }[]; seq: number }, keys: VaultItem[]) => ({
    fromVersion: vault.version,
    toVersion: vault.version + 1,
    wraps: vault.holders.map(({ type, id }) => ({ holderType: type, holderId: id, ...shapedWrap() })),
    items: keys.map(({ itemType, itemId, wrappedKey }) => ({ itemType, itemId, previousKey: wrappedKey, wrappedKey: b64(60) })),
    seq: vault.seq,
  });

  describe('POST /api/devices/:id/revoke', () => {
    it('revokes a trusted Appareil: its wraps deleted, its next wrap request 422 devices.revoked, the rotation pending, with its events; the Runner told', async () => {
      const alice = await pilot();
      const first = await linked(alice);
      const second = await approved(alice, first);

      const res = await page(alice, `/api/devices/${second.deviceId}/revoke`, { body: { seq: await seq(alice) }, deviceId: first.deviceId });

      expect(res.status).toBe(200);
      expect(zDevice.parse(await res.json())).toMatchObject({ id: second.deviceId, state: 'revoked', revokedAt: expect.any(String) });
      expect(await wrapsOf(alice.id)).toEqual([`device:${first.deviceId}:1`, `runner:${first.runnerId}:1`]);
      await expectEnvelope(await page(alice, `/api/devices/${second.deviceId}/vault-key-wrap`, { deviceId: second.deviceId }), 422, 'devices.revoked');
      await expectEnvelope(await page(alice, '/api/ideas?states=to-triage', { deviceId: second.deviceId }), 422, 'devices.revoked');
      const state = zState.parse(await (await page(alice, '/api/state')).json());
      expect(state.vault).toEqual({ version: 1, rotationPending: true });
      expect((await eventsOf(alice.id, 'device.upserted')).at(-1)).toMatchObject({ id: second.deviceId, state: 'revoked' });
      expect(await eventsOf(alice.id, 'vault.upserted')).toEqual([{ version: 1, rotationPending: true }]);
      expect(told).toEqual([expect.objectContaining({ pilotId: alice.id, type: 'vault.rotation-pending' })]);
      // The others still open the old version until the rotation.
      expect((await page(alice, `/api/devices/${first.deviceId}/vault-key-wrap`, { deviceId: first.deviceId })).status).toBe(200);
    });

    it('lists a revoked approver to the Runner as a voucher, never as a holder, so the Appareil it approved stays authenticated', async () => {
      const alice = await pilot();
      const first = await linked(alice);
      const laptop = await approved(alice, first, { runnerPublicKey: first.runnerPublicKey });
      const phone = await approved(alice, laptop, { runnerPublicKey: first.runnerPublicKey });

      expect((await page(alice, `/api/devices/${laptop.deviceId}/revoke`, { body: { seq: await seq(alice) }, deviceId: first.deviceId })).status).toBe(200);

      const res = await binary('/api/runner/devices/holders', { token: first.token });
      expect(res.status).toBe(200);
      const { holders, vouchers } = zDeviceHolders.parse(await res.json());
      expect(holders.map(({ deviceId, publicKey, approverPublicKey }) => ({ deviceId, publicKey, approverPublicKey }))).toEqual([
        { deviceId: phone.deviceId, publicKey: phone.publicKey, approverPublicKey: laptop.publicKey },
      ]);
      expect(vouchers?.map(({ deviceId, publicKey, approverPublicKey }) => ({ deviceId, publicKey, approverPublicKey }))).toEqual([
        { deviceId: laptop.deviceId, publicKey: laptop.publicKey, approverPublicKey: first.publicKey },
      ]);
    });

    it('revokes a pending Appareil without a rotation; an Appareil already revoked changes nothing', async () => {
      const alice = await pilot();
      const first = await linked(alice);
      const side = newDeviceSide();
      const created = zDeviceCreated.parse(await (await page(alice, '/api/devices', { body: side.request() })).json());

      const res = await page(alice, `/api/devices/${created.id}/revoke`, { body: { seq: await seq(alice) } });
      expect(res.status).toBe(200);
      const before = (await eventsOf(alice.id, 'device.upserted')).length;
      const again = await page(alice, `/api/devices/${created.id}/revoke`, { body: { seq: 0 } });

      expect(again.status).toBe(200);
      expect(zDevice.parse(await again.json())).toMatchObject({ state: 'revoked' });
      expect((await eventsOf(alice.id, 'device.upserted')).length).toBe(before);
      expect(await eventsOf(alice.id, 'vault.upserted')).toEqual([]);
      expect(told).toEqual([]);
      const [row] = await sql<{ short_id: string | null }>('SELECT short_id FROM devices WHERE id = $1', [created.id]);
      expect(row?.short_id).toBeNull();
      // Its code is dead: no approval.
      const body = { approver: { type: 'device', id: first.deviceId }, vaultKeyVersion: 1, wrap: shapedWrap(), proof: approvalProof(side.secret, side.publicKey, first.publicKey) };
      await expectEnvelope(await page(alice, `/api/devices/${created.id}/approve`, { body, deviceId: first.deviceId }), 409, 'devices.not-pending');
    });

    it('answers 409 realtime.stale with the seq before its last change, 404 for another Pilote’s, 400 without seq, 401 without a session', async () => {
      const alice = await pilot('alice');
      const bob = await pilot('bob');
      const first = await linked(alice);
      const second = await approved(alice, first);

      await expectEnvelope(await page(alice, `/api/devices/${second.deviceId}/revoke`, { body: { seq: 1 } }), 409, 'realtime.stale');
      await expectEnvelope(await page(bob, `/api/devices/${second.deviceId}/revoke`, { body: { seq: await seq(bob) } }), 404, 'devices.not-found');
      await expectEnvelope(await page(alice, `/api/devices/${newId()}/revoke`, { body: { seq: await seq(alice) } }), 404, 'devices.not-found');
      await expectEnvelope(await page(alice, `/api/devices/${second.deviceId}/revoke`, { body: {} }), 400, 'validation.invalid');
      await expectEnvelope(await page(undefined, `/api/devices/${second.deviceId}/revoke`, { body: { seq: 0 } }), 401, 'auth.required');
      const [row] = await sql<{ state: string }>('SELECT state FROM devices WHERE id = $1', [second.deviceId]);
      expect(row?.state).toBe('trusted');
    });
  });

  describe('what a revoked Appareil still reads (E2E-4)', () => {
    const sockets: WsClient[] = [];
    afterEach(async () => {
      await Promise.all(sockets.splice(0).map((client) => client.close()));
    });
    /** A tab's socket naming `device`, answered once open (a pong). */
    const socket = async (tab: Tab, device?: string): Promise<WsClient> => {
      const client = await connect(url, { cookie: tab.cookie, origin: ORIGIN, ...(device ? { device } : {}) });
      sockets.push(client);
      return client;
    };
    const answered = async (client: WsClient): Promise<WsClient> => {
      client.send({ type: 'ping' });
      await client.next('pong');
      return client;
    };

    it('answers 422 devices.revoked to every route the page calls naming a revoked Appareil, /api/state included; without the header, the state', async () => {
      const alice = await pilot();
      const first = await linked(alice);
      const second = await approved(alice, first);
      await page(alice, `/api/devices/${second.deviceId}/revoke`, { body: { seq: await seq(alice) }, deviceId: first.deviceId });

      for (const path of ['/api/state', '/api/ideas?states=to-triage', '/api/projects', '/api/me']) {
        await expectEnvelope(await page(alice, path, { deviceId: second.deviceId }), 422, 'devices.revoked');
      }
      expect((await page(alice, '/api/state')).status).toBe(200);
      expect((await page(alice, '/api/state', { deviceId: first.deviceId })).status).toBe(200);
    });

    it('closes with 4403 the sockets that name the Appareil revoked, refuses a new one naming it, and keeps the others', async () => {
      const alice = await pilot();
      const first = await linked(alice);
      const second = await approved(alice, first);
      const revokedTab = await answered(await socket(alice, second.deviceId));
      const trustedTab = await answered(await socket(alice, first.deviceId));
      const plainTab = await answered(await socket(alice));

      expect((await page(alice, `/api/devices/${second.deviceId}/revoke`, { body: { seq: await seq(alice) }, deviceId: first.deviceId })).status).toBe(200);

      expect(await revokedTab.closed()).toEqual({ code: WS_CLOSE.deviceRevoked, reason: 'device revoked' });
      await answered(trustedTab);
      await answered(plainTab);
      const late = await socket(alice, second.deviceId);
      late.send({ type: 'hello', lastSeq: null });
      expect(await late.closed()).toEqual({ code: WS_CLOSE.deviceRevoked, reason: 'device revoked' });
      expect(late.collect()).toEqual([]);
    });
  });

  describe('the last trusted Appareil (OPS-1)', () => {
    it('answers 409 devices.last-changed to the revocation of the last trusted Appareil the dialog did not warn of; warned, it is revoked', async () => {
      const alice = await pilot();
      const first = await linked(alice);
      const second = await approved(alice, first);

      expect((await page(alice, `/api/devices/${first.deviceId}/revoke`, { body: { seq: await seq(alice), last: false } })).status).toBe(200);
      await expectEnvelope(await page(alice, `/api/devices/${second.deviceId}/revoke`, { body: { seq: await seq(alice) } }), 409, 'devices.last-changed');
      const [row] = await sql<{ state: string }>('SELECT state FROM devices WHERE id = $1', [second.deviceId]);
      expect(row?.state).toBe('trusted');
      expect((await page(alice, `/api/devices/${second.deviceId}/revoke`, { body: { seq: await seq(alice), last: true } })).status).toBe(200);
    });

    it('lets one of two concurrent dialogs, each shown with two trusted Appareils, revoke; the other gets 409 devices.last-changed', async () => {
      const alice = await pilot();
      const first = await linked(alice);
      const second = await approved(alice, first);
      const at = await seq(alice);

      const answers = await Promise.all(
        [first, second].map((device) => page(alice, `/api/devices/${device.deviceId}/revoke`, { body: { seq: at, last: false } })),
      );

      expect(answers.map((res) => res.status).sort()).toEqual([200, 409]);
      const refused = answers.find((res) => res.status === 409);
      if (refused) await expectEnvelope(refused, 409, 'devices.last-changed');
      const rows = await sql<{ state: string }>(`SELECT state FROM devices WHERE pilot_id = $1 AND state = 'trusted'`, [alice.id]);
      expect(rows).toHaveLength(1);
    });
  });

  describe('a revocation beside another writer of the Appareil (lock order)', () => {
    /**
     * The Pilote's row held by another transaction while the revocation, then
     * `other`, queue behind it, in that order: once released, the revocation
     * holds the Pilote and wants the Appareil. A writer that locked the
     * Appareil before the Pilote would deadlock with it (one of them 500).
     */
    const behindThePilote = async (tab: Tab, revoke: () => Promise<Response>, other: () => Promise<Response>) => {
      const waiting = async () => (await sql<{ n: number }>(`SELECT count(*)::int AS n FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND datname = current_database()`))[0]?.n;
      const holder = new pg.Client({ connectionString: databaseUrl });
      await holder.connect();
      try {
        await holder.query('BEGIN');
        await holder.query('SELECT id FROM pilots WHERE id = $1 FOR UPDATE', [tab.id]);
        const revoked = revoke();
        await expect.poll(waiting, { timeout: 5000, interval: 20 }).toBe(1);
        const answered = other();
        await expect.poll(waiting, { timeout: 5000, interval: 20 }).toBe(2);
        await holder.query('COMMIT');
        return await Promise.all([revoked, answered]);
      } finally {
        await holder.end();
      }
    };

    it('the first call of the hour naming the Appareil, at once with its revocation: both answer, its lastSeenAt left as it was', async () => {
      const alice = await pilot();
      const first = await linked(alice);
      const second = await approved(alice, first);
      const at = await seq(alice);
      await sql('UPDATE devices SET last_seen_at = NULL WHERE id = $1', [second.deviceId]);

      const [revoked, seen] = await behindThePilote(
        alice,
        () => page(alice, `/api/devices/${second.deviceId}/revoke`, { body: { seq: at, last: false } }),
        () => page(alice, '/api/me', { deviceId: second.deviceId }),
      );

      expect([revoked.status, seen.status]).toEqual([200, 200]);
      const [row] = await sql<{ state: string; last_seen_at: Date | null }>('SELECT state, last_seen_at FROM devices WHERE id = $1', [second.deviceId]);
      expect(row).toEqual({ state: 'revoked', last_seen_at: null });
    });

    it('the approval of a pending Appareil, at once with its revocation: the revocation wins, the approval 409 devices.not-pending', async () => {
      const alice = await pilot();
      const first = await linked(alice);
      const side = newDeviceSide();
      const created = zDeviceCreated.parse(await (await page(alice, '/api/devices', { body: side.request() })).json());
      const at = await seq(alice);
      const body = { approver: { type: 'device', id: first.deviceId }, vaultKeyVersion: 1, wrap: shapedWrap(), proof: approvalProof(side.secret, side.publicKey, first.publicKey) };
      // The approver seen just now: what waits behind the revocation is the approval itself.
      await sql('UPDATE devices SET last_seen_at = now() WHERE id = $1', [first.deviceId]);

      const [revoked, approval] = await behindThePilote(
        alice,
        () => page(alice, `/api/devices/${created.id}/revoke`, { body: { seq: at } }),
        () => page(alice, `/api/devices/${created.id}/approve`, { body, deviceId: first.deviceId }),
      );

      expect(revoked.status).toBe(200);
      await expectEnvelope(approval, 409, 'devices.not-pending');
      expect(await wrapsOf(alice.id)).not.toContain(`device:${created.id}:1`);
    });
  });

  describe('the rotation by a trusted Appareil', () => {
    it('moves the version: every holder’s wrap of v+1 stored, the older deleted, each item key replaced with its ciphertext kept, with vault.upserted; the Runner gets its wrap', async () => {
      const alice = await pilot();
      const first = await linked(alice);
      const second = await approved(alice, first);
      const third = await approved(alice, first);
      const { versionId, ideas, localId, sessionId, local: localRows } = await items(alice);
      await page(alice, `/api/devices/${third.deviceId}/revoke`, { body: { seq: await seq(alice) } });
      told.length = 0;

      const vault = zVault.parse(await (await page(alice, '/api/vault', { deviceId: first.deviceId })).json());
      expect(vault).toMatchObject({ version: 1, rotationPending: true });
      expect(vault.holders).toEqual([
        { type: 'device', id: first.deviceId, publicKey: first.publicKey },
        { type: 'device', id: second.deviceId, publicKey: second.publicKey },
        { type: 'runner', id: first.runnerId, publicKey: first.runnerPublicKey },
      ]);
      const keys = await allItems((cursor) => page(alice, `/api/vault/items${cursor ? `?cursor=${cursor}` : ''}`, { deviceId: first.deviceId }));
      expect(keys.map(({ itemType, aad }) => `${itemType} ${aad}`).sort()).toEqual(
        [`idea.analysis ${ideas[1]}:analysis`, `idea.analysis-pending ${ideas[1]}:analysis`, `idea.text ${ideas[0]}:text`, `idea.text ${ideas[1]}:text`, `process-version.sealed process:${(await sql<{ project_id: string }>('SELECT project_id FROM process_versions'))[0]?.project_id}`,
          `project.name project:${localId}:name`,
          `agent-session.title ticket:${localId}:3:title`,
          `ticket.title local:${localId}:ticket:3:title`,
          `ticket.labels local:${localId}:ticket:3:labels`,
          `milestone.title local:${localId}:milestone:1:title`,
          `code-change.title local:${localId}:change:31:title`,
          `decision.local-unreadable-path local:${localId}:unreadable:${UNREADABLE_KEY}:path`,
        ].sort(),
      );
      const before = await sql<{ text: { ciphertext: string } }>('SELECT text FROM ideas WHERE id = $1', [ideas[0]]);
      const [pendingBefore] = await sql<{ analysis_pending: { sealed: { ciphertext: string } } }>('SELECT analysis_pending FROM ideas WHERE id = $1', [ideas[1]]);
      const localSealed = async () => {
        const [ticket] = await sql<{ title_sealed: unknown; labels_sealed: unknown }>('SELECT title_sealed, labels_sealed FROM tickets WHERE id = $1', [localRows.ticketId]);
        const [milestone] = await sql<{ title_sealed: unknown }>('SELECT title_sealed FROM milestones WHERE id = $1', [localRows.milestoneId]);
        const [change] = await sql<{ title_sealed: unknown }>('SELECT title_sealed FROM code_changes WHERE id = $1', [localRows.changeId]);
        const [decision] = await sql<{ params: { pathSealed: string; reason: string } }>('SELECT params FROM decisions WHERE id = $1', [localRows.decisionId]);
        const [key, ciphertext] = (decision?.params.pathSealed ?? '').split('.');
        return {
          'ticket.title': ticket?.title_sealed,
          'ticket.labels': ticket?.labels_sealed,
          'milestone.title': milestone?.title_sealed,
          'code-change.title': change?.title_sealed,
          'decision.local-unreadable-path': { key, ciphertext, reason: decision?.params.reason },
        } as Record<string, { key: string; ciphertext: string; reason?: string }>;
      };
      const localBefore = await localSealed();
      const rotation = rotationOf(vault, keys);

      const res = await page(alice, '/api/vault/rotations', { body: rotation, deviceId: first.deviceId });

      expect(res.status).toBe(200);
      expect(zVaultState.parse(await res.json())).toEqual({ version: 2, rotationPending: false });
      expect(await wrapsOf(alice.id)).toEqual([`device:${first.deviceId}:2`, `device:${second.deviceId}:2`, `runner:${first.runnerId}:2`].sort());
      const [idea] = await sql<{ text: { key: string; ciphertext: string } }>('SELECT text FROM ideas WHERE id = $1', [ideas[0]]);
      expect(idea?.text).toEqual({ key: rotation.items.find((item) => item.itemId === ideas[0] && item.itemType === 'idea.text')?.wrappedKey, ciphertext: before[0]?.text.ciphertext });
      // The pending report keeps its figures and its ciphertext, under the new item key.
      const [pending] = await sql<{ analysis_pending: unknown }>('SELECT analysis_pending FROM ideas WHERE id = $1', [ideas[1]]);
      expect(pending?.analysis_pending).toEqual({
        ...pendingBefore?.analysis_pending,
        sealed: { key: rotation.items.find((item) => item.itemId === ideas[1] && item.itemType === 'idea.analysis-pending')?.wrappedKey, ciphertext: pendingBefore?.analysis_pending.sealed.ciphertext },
      });
      const [version] = await sql<{ sealed: { key: string } }>('SELECT sealed FROM process_versions WHERE id = $1', [versionId]);
      expect(version?.sealed.key).toBe(rotation.items.find((item) => item.itemId === versionId)?.wrappedKey);
      const [local] = await sql<{ name_sealed: { key: string } }>('SELECT name_sealed FROM projects WHERE id = $1', [localId]);
      expect(local?.name_sealed.key).toBe(rotation.items.find((item) => item.itemId === localId && item.itemType === 'project.name')?.wrappedKey);
      const sessionBefore = keys.find((item) => item.itemType === 'agent-session.title');
      const [session] = await sql<{ title_sealed: { key: string; ciphertext: string }; title_aad: string }>('SELECT title_sealed, title_aad FROM agent_sessions WHERE id = $1', [sessionId]);
      expect(session?.title_sealed.key).toBe(rotation.items.find((item) => item.itemId === sessionId && item.itemType === 'agent-session.title')?.wrappedKey);
      expect(session?.title_sealed.key).not.toBe(sessionBefore?.wrappedKey);
      expect(session?.title_aad).toBe(`ticket:${localId}:3:title`);
      // A Local Projet's texts keep their ciphertext under the new item key (the Décision its reason).
      const localAfter = await localSealed();
      for (const [itemType, stored] of Object.entries(localBefore)) {
        const wrappedKey = rotation.items.find((item) => item.itemType === itemType)?.wrappedKey;
        expect(wrappedKey).toBeDefined();
        expect(localAfter[itemType]).toEqual({ ...stored, key: wrappedKey });
      }
      expect((await eventsOf(alice.id, 'vault.upserted')).at(-1)).toEqual({ version: 2, rotationPending: false });
      const runnerWrap = rotation.wraps.find(({ holderType }) => holderType === 'runner');
      expect(told).toEqual([
        { pilotId: alice.id, type: 'vault.rotated', message: { type: 'vault.rotated', vaultKeyWrap: { vaultKeyVersion: 2, enc: runnerWrap?.enc, ciphertext: runnerWrap?.ciphertext, tag: runnerWrap?.tag } } },
      ]);
      const wrap = await page(alice, `/api/devices/${second.deviceId}/vault-key-wrap`, { deviceId: second.deviceId });
      expect(await wrap.json()).toMatchObject({ vaultKeyVersion: 2 });
    });

    it('answers 409 vault.version-changed to a second rotation from the same version, 409 realtime.stale to a seq before the vault’s last change', async () => {
      const alice = await pilot();
      const first = await linked(alice);
      const second = await approved(alice, first);
      await page(alice, `/api/devices/${second.deviceId}/revoke`, { body: { seq: await seq(alice) } });
      const vault = zVault.parse(await (await page(alice, '/api/vault', { deviceId: first.deviceId })).json());
      const rotation = rotationOf(vault, []);

      await expectEnvelope(await page(alice, '/api/vault/rotations', { body: { ...rotation, seq: vault.seq - 1 }, deviceId: first.deviceId }), 409, 'realtime.stale');
      expect((await page(alice, '/api/vault/rotations', { body: rotation, deviceId: first.deviceId })).status).toBe(200);
      await expectEnvelope(await page(alice, '/api/vault/rotations', { body: rotation, deviceId: first.deviceId }), 409, 'vault.version-changed');
    });

    it('answers 422 vault.holders-missing to a holder left out, one added or twice; 422 vault.items-missing to an item left out or unknown', async () => {
      const alice = await pilot();
      const first = await linked(alice);
      const second = await approved(alice, first);
      await items(alice);
      const vault = zVault.parse(await (await page(alice, '/api/vault', { deviceId: first.deviceId })).json());
      const keys = await allItems((cursor) => page(alice, `/api/vault/items${cursor ? `?cursor=${cursor}` : ''}`, { deviceId: first.deviceId }));
      const rotation = rotationOf(vault, keys);
      const rotate = (body: unknown) => page(alice, '/api/vault/rotations', { body, deviceId: first.deviceId });

      await expectEnvelope(await rotate({ ...rotation, wraps: rotation.wraps.filter(({ holderId }) => holderId !== second.deviceId) }), 422, 'vault.holders-missing');
      await expectEnvelope(await rotate({ ...rotation, wraps: [...rotation.wraps, { holderType: 'device', holderId: newId(), ...shapedWrap() }] }), 422, 'vault.holders-missing');
      await expectEnvelope(await rotate({ ...rotation, wraps: [...rotation.wraps.slice(1), rotation.wraps[1]] }), 422, 'vault.holders-missing');
      await expectEnvelope(await rotate({ ...rotation, items: rotation.items.slice(1) }), 422, 'vault.items-missing');
      await expectEnvelope(await rotate({ ...rotation, items: [...rotation.items.slice(1), { itemType: 'idea.text', itemId: newId(), previousKey: b64(60), wrappedKey: b64(60) }] }), 422, 'vault.items-missing');
      await expectEnvelope(await rotate({ ...rotation, toVersion: 3 }), 400, 'validation.invalid');
      expect(await wrapsOf(alice.id)).toHaveLength(3);
      expect(zState.parse(await (await page(alice, '/api/state')).json()).vault.version).toBe(1);
    });

    it('answers 409 vault.items-changed when an item key is no longer the one read (written again since GET items, or a previousKey wrong): nothing changes', async () => {
      const alice = await pilot();
      const first = await linked(alice);
      const second = await approved(alice, first);
      await page(alice, `/api/devices/${second.deviceId}/revoke`, { body: { seq: await seq(alice) } });
      const { versionId, ideas } = await items(alice);
      const vault = zVault.parse(await (await page(alice, '/api/vault', { deviceId: first.deviceId })).json());
      const keys = await allItems((cursor) => page(alice, `/api/vault/items${cursor ? `?cursor=${cursor}` : ''}`, { deviceId: first.deviceId }));
      const rotation = rotationOf(vault, keys);
      const rotate = (body: unknown) => page(alice, '/api/vault/rotations', { body, deviceId: first.deviceId });
      const stored = async () => ({
        ideas: await sql('SELECT id, text, analysis FROM ideas ORDER BY id'),
        versions: await sql('SELECT id, sealed FROM process_versions WHERE id = $1', [versionId]),
        wraps: await wrapsOf(alice.id),
        version: zState.parse(await (await page(alice, '/api/state')).json()).vault,
      });

      // A previousKey that was never the stored one, for one item only.
      const wrong = rotation.items.map((item) => (item.itemId === versionId ? { ...item, previousKey: b64(60) } : item));
      const before = await stored();
      await expectEnvelope(await rotate({ ...rotation, items: wrong }), 409, 'vault.items-changed');
      expect(await stored()).toEqual(before);

      // The Idée's text sealed again (a new key) between GET items and the rotation.
      await sql('UPDATE ideas SET text = $2 WHERE id = $1', [ideas[0], JSON.stringify(sealed())]);
      const written = await stored();
      await expectEnvelope(await rotate(rotation), 409, 'vault.items-changed');
      expect(await stored()).toEqual(written);
      expect(written.version).toEqual({ version: 1, rotationPending: true });

      // Read again, the rotation goes through.
      const again = rotationOf(vault, await allItems((cursor) => page(alice, `/api/vault/items${cursor ? `?cursor=${cursor}` : ''}`, { deviceId: first.deviceId })));
      expect((await rotate(again)).status).toBe(200);
    });

    it('serves the vault to a trusted Appareil only: 422 devices.not-trusted without the header or for a pending one, devices.revoked for a revoked one; 401 without a session', async () => {
      const alice = await pilot('alice');
      const bob = await pilot('bob');
      const first = await linked(alice);
      const second = await approved(alice, first);
      const created = zDeviceCreated.parse(await (await page(alice, '/api/devices', { body: newDeviceSide().request() })).json());
      await page(alice, `/api/devices/${second.deviceId}/revoke`, { body: { seq: await seq(alice) } });

      await expectEnvelope(await page(alice, '/api/vault'), 422, 'devices.not-trusted');
      await expectEnvelope(await page(alice, '/api/vault', { deviceId: created.id }), 422, 'devices.not-trusted');
      await expectEnvelope(await page(alice, '/api/vault/items', { deviceId: second.deviceId }), 422, 'devices.revoked');
      await expectEnvelope(await page(bob, '/api/vault', { deviceId: first.deviceId }), 422, 'devices.not-trusted');
      await expectEnvelope(await page(alice, '/api/vault/items?cursor=pas-un-curseur', { deviceId: first.deviceId }), 422, 'vault.cursor-invalid');
      await expectEnvelope(await page(undefined, '/api/vault', { deviceId: first.deviceId }), 401, 'auth.required');
    });
  });

  describe('the Runner’s vault routes (its token)', () => {
    it('lets the Runner rotate, without telling it its own wrap', async () => {
      const alice = await pilot();
      const first = await linked(alice);
      const second = await approved(alice, first);
      await items(alice);
      await page(alice, `/api/devices/${second.deviceId}/revoke`, { body: { seq: await seq(alice) } });
      told.length = 0;

      const vault = zVault.parse(await (await binary('/api/runner/vault', { token: first.token })).json());
      const keys = await allItems((cursor) => binary(`/api/runner/vault/items${cursor ? `?cursor=${cursor}` : ''}`, { token: first.token }));
      const res = await binary('/api/runner/vault/rotations', { body: rotationOf(vault, keys), token: first.token });

      expect(res.status).toBe(200);
      expect(zVaultState.parse(await res.json())).toEqual({ version: 2, rotationPending: false });
      expect(await wrapsOf(alice.id)).toEqual([`device:${first.deviceId}:2`, `runner:${first.runnerId}:2`]);
      expect(told).toEqual([]);
    });

    it('answers 401 runner.token-invalid without a token or with a page’s session only', async () => {
      const alice = await pilot();
      const first = await linked(alice);

      await expectEnvelope(await binary('/api/runner/vault'), 401, 'runner.token-invalid');
      await expectEnvelope(await binary('/api/runner/vault/items', { token: 'pas-un-jeton' }), 401, 'runner.token-invalid');
      await expectEnvelope(await page(alice, '/api/runner/vault', { deviceId: first.deviceId }), 401, 'runner.token-invalid');
    });

    it('a new link revokes the old Runner: its wraps deleted, the rotation pending', async () => {
      const alice = await pilot();
      const first = await linked(alice);
      const sides = first.sides;
      const code = (await (await page(alice, '/api/runner/link-codes', { body: { pairing: sides.browser() }, deviceId: first.deviceId })).json()) as { id: string; shortId: string };
      const accepted = (await (await binary('/api/runner/link', { body: { ...MACHINE, machine: 'portable', shortId: code.shortId } })).json()) as { linkId: string };
      await binary(`/api/runner/link/${accepted.linkId}/pairing`, { body: { pairing: sides.runner(code.shortId) } });
      const res = await page(alice, `/api/runner/link-codes/${code.id}/confirm`, { body: { pairing: sides.confirm(code.shortId, 1, false), seq: await seq(alice) }, deviceId: first.deviceId });
      expect(res.status).toBe(200);

      const wraps = await wrapsOf(alice.id);
      expect(wraps).toContain(`device:${first.deviceId}:1`);
      expect(wraps.some((wrap) => wrap.startsWith(`runner:${first.runnerId}`))).toBe(false);
      expect(wraps.filter((wrap) => wrap.startsWith('runner:'))).toHaveLength(1);
      expect(zState.parse(await (await page(alice, '/api/state')).json()).vault).toEqual({ version: 1, rotationPending: true });
    });
  });
});
