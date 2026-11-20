import { type SourceMigration, zProjectList, zSourceMigration, zState, zTicket } from '@crewdeck/contracts';
import type { INestApplication } from '@nestjs/common';
import pg from 'pg';
import { inject } from 'vitest';
import { SESSION_COOKIE } from '../../src/auth/cookies.js';
import { WebSessions } from '../../src/auth/web-sessions.js';
import { appOrigin, parseEnv } from '../../src/config/env.js';
import { WebhookDispatcher } from '../../src/github/webhooks/dispatcher.js';
import { newId } from '../../src/ids.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { SourceMigrations } from '../../src/process/sources/migrations/source-migrations.service.js';
import { runInPilotScope } from '../../src/scope/scope.context.js';
import { FAKES, type Fakes } from '../../src/testing/fakes.js';
import { createLinkedRunner } from '../../src/testing/runners.js';
import { deliverWebhook, TEST_WEBHOOK_SECRET, webhookFixture } from '../fakes/github.js';
import { connectRunner, type FakeRunnerClient } from '../fakes/runner.js';
import { authKeysEnv } from '../github-app.js';
import { startApp } from '../route-baseline.js';

const databaseUrl = inject('databaseUrl');
const env = parseEnv({
  CREWDECK_ENV: 'test',
  DATABASE_URL: databaseUrl,
  CREWDECK_FAKES: '1',
  PUBLIC_URL: 'https://crewdeck.example',
  GITHUB_WEBHOOK_SECRET: TEST_WEBHOOK_SECRET,
  ...authKeysEnv(),
});
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

const SENDER_ID = 9100001;
const INSTALLATION_ID = 51000001;
const created = webhookFixture<Record<string, unknown>>('installation.created');
const APP_REPO = { owner: 'octo-fixture', name: 'fixture-app', id: 71000001 };
const FULL_NAME = `${APP_REPO.owner}/${APP_REPO.name}`;
const REPO_URL = `https://api.github.com/repos/${FULL_NAME}`;
const REPOSITORY = { id: APP_REPO.id, name: APP_REPO.name, full_name: FULL_NAME, private: true, owner: { login: APP_REPO.owner } };
const bytes = (n: number) => Buffer.alloc(n, 7).toString('base64url');
const SEALED = { key: bytes(60), ciphertext: bytes(32) };
const FINGERPRINT = { key: 'local#12', state: 'open', contentHash: 'a'.repeat(64) };

interface EventRow {
  seq: string;
  type: string;
  payload: Record<string, unknown>;
  tx: string;
}

interface TicketDbRow {
  number: number;
  former_number: number | null;
  former_source: string | null;
  source: string;
  title: string | null;
  sealed: boolean;
  labels: string[];
  parent_number: number | null;
  blocked_by: number[];
  milestone_number: number | null;
  tx: string;
}

describe('the switch of the Tickets to another Source (SOURCE-8), against PostgreSQL', () => {
  let app: INestApplication;
  let url: string;
  let prisma: PrismaService;
  let fakes: Fakes;
  let migrations: SourceMigrations;
  let alice: { id: string; cookie: string; token: string };
  let projectId: string;
  const sockets: FakeRunnerClient[] = [];

  beforeAll(async () => {
    ({ app, url } = await startApp(env));
    prisma = app.get(PrismaService);
    fakes = app.get<Fakes>(FAKES);
    migrations = app.get(SourceMigrations);
  });

  const empty = () => sql('TRUNCATE pilots, github_installations, github_deliveries CASCADE');

  afterAll(async () => {
    await empty();
    await app.close();
  });

  const call = (method: 'GET' | 'POST', path: string, body?: unknown): Promise<Response> =>
    fetch(`${url}${path}`, {
      method,
      headers: { cookie: alice.cookie, origin: ORIGIN, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const state = async () => zState.parse(await (await call('GET', '/api/state')).json());
  const lastSeq = async (): Promise<string> => (await sql<{ seq: string }>('SELECT seq::text FROM pilots WHERE id = $1', [alice.id]))[0]?.seq ?? '0';
  const eventsSince = (seq: string) => sql<EventRow>('SELECT seq::text, type, payload, xmin::text AS tx FROM events WHERE pilot_id = $1 AND seq > $2 ORDER BY seq', [alice.id, seq]);
  const rows = () =>
    sql<TicketDbRow>(
      `SELECT number, former_number, former_source, source, title, title_sealed IS NOT NULL AS sealed, labels, parent_number, blocked_by, milestone_number, xmin::text AS tx
       FROM tickets WHERE project_id = $1 ORDER BY number`,
      [projectId],
    );
  const milestoneRows = () =>
    sql<{ number: number; rank: number; source: string; title: string | null; sealed: boolean }>(
      'SELECT number, rank, source, title, title_sealed IS NOT NULL AS sealed FROM milestones WHERE project_id = $1 ORDER BY number',
      [projectId],
    );
  const ticketSource = async () => (await sql<{ source: string }>(`SELECT source FROM artifact_sources WHERE project_id = $1 AND "group" = 'ticket'`, [projectId]))[0]?.source;
  const migrationRow = async (id: string) => (await sql<{ state: string; error_code: string | null }>('SELECT state, error_code FROM source_migrations WHERE id = $1', [id]))[0];

  beforeEach(async () => {
    await empty();
    fakes.github.reset();
    fakes.github.seedRepo({ ...APP_REPO, installationId: INSTALLATION_ID, files: { 'README.md': '# App' } });
    const id = newId();
    await sql(
      `WITH p AS (INSERT INTO pilots (id, display_name, time_zone, getting_started_step, vault_key_version) VALUES ($1, 'octo-fixture', 'Europe/Paris', 'done', 1) RETURNING id) INSERT INTO pilot_identities (id, pilot_id, provider, subject, login) SELECT gen_random_uuid(), id, 'github', $2::text, 'octo-fixture' FROM p`,
      [id, SENDER_ID],
    );
    const cookie = `${SESSION_COOKIE}=${await runInPilotScope(id, () => app.get(WebSessions).open(prisma.scoped, id, undefined))}`;
    const { token } = await createLinkedRunner(prisma, id);
    alice = { id, cookie, token };
    expect((await deliverWebhook(url, { event: 'installation', payload: created })).status).toBe(202);
    await app.get(WebhookDispatcher).settled();
    const { seq, repositories } = await state();
    const followed = await call('POST', '/api/projects', { repositoryIds: repositories.map((repository) => repository.id), templateId: 'process-crewdeck', seq: String(seq) });
    expect(followed.status).toBe(201);
    projectId = zProjectList.parse(await followed.json()).items[0]?.id ?? '';
  });

  afterEach(async () => {
    await migrations.idle();
    await Promise.all(sockets.splice(0).map((socket) => socket.close()));
  });

  const online = async (): Promise<FakeRunnerClient> => {
    const socket = await connectRunner(url, alice.token);
    sockets.push(socket);
    socket.hello({ migrations: ['ticket'] });
    await socket.expect('hello.accepted');
    return socket;
  };

  /** A Ticket row as its Source writes it: sealed texts on Local, readable ones on GitHub. */
  const ticket = async (source: 'local' | 'github', number: number, fields: { state?: string; parent?: number; blockedBy?: number[]; milestone?: number; labels?: string[] } = {}) => {
    const local = source === 'local';
    await sql(
      `INSERT INTO tickets (id, pilot_id, project_id, source, number, title, title_sealed, labels, labels_sealed, state, state_reason, closed_at, ready_mark, ready, branch_prefix, visual_review,
                            parent_number, blocked_by, milestone_number, source_created_at, source_updated_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, true, false, 'feat', false, $13, $14, $15, now(), now(), now())`,
      [
        newId(),
        alice.id,
        projectId,
        source,
        number,
        local ? null : `Ticket ${number}`,
        local ? JSON.stringify(SEALED) : null,
        fields.labels ?? ['ready-for-agent'],
        local ? JSON.stringify(SEALED) : null,
        fields.state ?? 'open',
        fields.state === 'closed' ? 'completed' : null,
        fields.state === 'closed' ? new Date() : null,
        fields.parent ?? null,
        fields.blockedBy ?? [],
        fields.milestone ?? null,
      ],
    );
  };
  const milestone = async (source: 'local' | 'github', number: number) =>
    sql(
      `INSERT INTO milestones (id, pilot_id, project_id, source, number, rank, title, title_sealed, state, open_count, closed_count, updated_at) VALUES ($1, $2, $3, $4, $5, $5, $6, $7, 'open', 0, 0, now())`,
      [newId(), alice.id, projectId, source, number, source === 'local' ? null : `Jalon ${number}`, source === 'local' ? JSON.stringify(SEALED) : null],
    );

  /** A migration of the Tickets to `to`, copying on an online Runner. */
  const copying = async (to: 'github' | 'local'): Promise<{ migration: SourceMigration; socket: FakeRunnerClient }> => {
    const socket = await online();
    const res = await call('POST', `/api/projects/${projectId}/sources/ticket/migrate`, { to, seq: await lastSeq() });
    expect(res.status).toBe(201);
    const migration = zSourceMigration.parse(await res.json());
    await socket.expect('migration.copy');
    await vi.waitFor(async () => expect((await migrationRow(migration.id))?.state).toBe('copying'));
    return { migration, socket };
  };

  /** The webhook of an issue the copy created: the body ends with its origin marker. */
  const issueOpened = async (number: number, title: string, from: number) => {
    const issue = fakes.github.seedIssue(APP_REPO, { number, title, body: `Le texte.\n\n<!-- crewdeck:from local#${from} -->`, labels: ['ready-for-agent'] });
    const payload = {
      action: 'opened',
      installation: { id: INSTALLATION_ID },
      repository: REPOSITORY,
      sender: { id: SENDER_ID, login: 'octo-fixture' },
      issue: {
        number: issue.number,
        title: issue.title,
        state: issue.state,
        state_reason: issue.stateReason,
        labels: issue.labels.map((name, index) => ({ id: index + 1, name, color: 'ededed' })),
        milestone: null,
        created_at: issue.createdAt,
        closed_at: issue.closedAt,
        updated_at: issue.updatedAt,
        body: 'Le texte.',
        repository_url: REPO_URL,
        user: { login: 'octo-fixture' },
      },
    };
    expect((await deliverWebhook(url, { event: 'issues', payload })).status).toBe(202);
    await app.get(WebhookDispatcher).settled();
  };

  it('Local → GitHub: every row and milestone renumbered in the switch’s transaction, « #57 (ex-#12) », the titles filled by the reconciliation; the copy’s issues are no rows before', async () => {
    await sql(`UPDATE artifact_sources SET source = 'local' WHERE project_id = $1 AND "group" = 'ticket'`, [projectId]);
    await milestone('local', 1);
    await milestone('local', 2);
    await ticket('local', 12, { milestone: 1, parent: 15, blockedBy: [14] });
    await ticket('local', 14, { state: 'closed', milestone: 2 });
    await ticket('local', 15);
    const { migration, socket } = await copying('github');

    // The copy writes its issues on GitHub: their webhooks write no row while the Tickets are Local.
    fakes.github.seedMilestone(APP_REPO, { number: 3, title: 'MVP' });
    fakes.github.seedMilestone(APP_REPO, { number: 4, title: 'V2' });
    await issueOpened(57, 'Le panier', 12);
    await issueOpened(58, 'Le paiement', 14);
    await issueOpened(59, 'La boutique', 15);
    fakes.github.seedIssue(APP_REPO, { number: 57, title: 'Le panier', labels: ['ready-for-agent'], milestone: { number: 3, title: 'MVP' }, blockedBy: [{ ...APP_REPO, number: 58, state: 'closed' }] });
    fakes.github.seedIssue(APP_REPO, { number: 58, title: 'Le paiement', state: 'closed', milestone: { number: 4, title: 'V2' } });
    fakes.github.seedIssue(APP_REPO, { number: 59, title: 'La boutique', labels: ['ready-for-agent'], subIssues: [57] });
    expect((await rows()).map((row) => [row.number, row.source])).toEqual([
      [12, 'local'],
      [14, 'local'],
      [15, 'local'],
    ]);

    const before = await lastSeq();
    socket.send({
      type: 'migration.switch',
      migrationId: migration.id,
      fingerprints: [FINGERPRINT],
      renumbering: [
        { from: 12, to: 57 },
        { from: 14, to: 58 },
        { from: 15, to: 59 },
      ],
      milestones: [
        { from: 1, to: 3 },
        { from: 2, to: 4 },
      ],
    });
    await socket.expect('migration.finish');

    // Read once committed: the reconciliation may already have filled a title.
    expect((await rows()).map(({ tx: _tx, title: _title, labels: _labels, ...row }) => row)).toEqual([
      { number: 57, former_number: 12, former_source: 'local', source: 'github', sealed: false, parent_number: 59, blocked_by: [58], milestone_number: 3 },
      { number: 58, former_number: 14, former_source: 'local', source: 'github', sealed: false, parent_number: null, blocked_by: [], milestone_number: 4 },
      { number: 59, former_number: 15, former_source: 'local', source: 'github', sealed: false, parent_number: null, blocked_by: [], milestone_number: null },
    ]);
    const events = await eventsSince(before);
    const switchEvent = events.find((event) => event.type === 'source-migration.upserted' && event.payload.state === 'switched');
    const moved = events.filter((event) => event.type === 'ticket.upserted' && event.tx === switchEvent?.tx);
    expect(moved.map((event) => [event.payload.number, event.payload.formerNumber, event.payload.formerSource])).toEqual([
      [57, 12, 'local'],
      [58, 14, 'local'],
      [59, 15, 'local'],
    ]);
    for (const event of moved) expect(zTicket.safeParse(event.payload).success).toBe(true);
    expect(events.filter((event) => event.type === 'milestone.upserted' && event.tx === switchEvent?.tx).map((event) => event.payload.number)).toEqual([3, 4]);

    // The reconciliation after the commit fills the titles from GitHub.
    await vi.waitFor(async () => expect((await rows()).map((row) => row.title)).toEqual(['Le panier', 'Le paiement', 'La boutique']));
    const { tickets, milestones } = await state();
    expect(tickets.find((item) => item.number === 57)).toMatchObject({ number: 57, formerNumber: 12, formerSource: 'local', source: 'github', title: 'Le panier', titleSealed: null, labelsSealed: null, parentNumber: 59, blockedBy: [58], milestoneNumber: 3 });
    expect(milestones.map((item) => [item.number, item.title, item.source])).toEqual([
      [3, 'MVP', 'github'],
      [4, 'V2', 'github'],
    ]);
    expect(await ticketSource()).toBe('github');
  });

  it('a renumbering that misses a row or names an unknown one fails the migration before the point of no return, every row as it was', async () => {
    await sql(`UPDATE artifact_sources SET source = 'local' WHERE project_id = $1 AND "group" = 'ticket'`, [projectId]);
    await ticket('local', 12);
    await ticket('local', 14);
    for (const renumbering of [[{ from: 12, to: 57 }], [{ from: 12, to: 57 }, { from: 14, to: 58 }, { from: 99, to: 59 }]]) {
      const { migration, socket } = await copying('github');
      socket.send({ type: 'migration.switch', migrationId: migration.id, fingerprints: [FINGERPRINT], renumbering, milestones: [] });
      await vi.waitFor(async () => expect(await migrationRow(migration.id)).toEqual({ state: 'failed', error_code: 'source-migration.switch-failed' }));
      expect((await rows()).map((row) => [row.number, row.former_number, row.source, row.sealed])).toEqual([
        [12, null, 'local', true],
        [14, null, 'local', true],
      ]);
      expect(await ticketSource()).toBe('local');
      await migrations.idle();
    }
  });

  it('GitHub → Local: the plain texts cleared, only the product’s labels kept readable, then the Runner’s scan seals them again', async () => {
    // The code already in the Projet's folder: Local has a place.
    await sql(`UPDATE artifact_sources SET source = 'local' WHERE project_id = $1 AND "group" = 'code'`, [projectId]);
    await milestone('github', 3);
    await ticket('github', 57, { labels: ['ready-for-agent', 'priority:P1', 'bug'], milestone: 3, blockedBy: [58] });
    await ticket('github', 58, { state: 'closed' });
    const { migration, socket } = await copying('local');

    socket.send({
      type: 'migration.switch',
      migrationId: migration.id,
      fingerprints: [{ key: 'github#57', state: 'open', contentHash: 'b'.repeat(64) }],
      renumbering: [
        { from: 57, to: 1 },
        { from: 58, to: 2 },
      ],
      milestones: [{ from: 3, to: 1 }],
    });
    await socket.expect('migration.finish');

    expect((await rows()).map(({ tx: _tx, ...row }) => row)).toEqual([
      { number: 1, former_number: 57, former_source: 'github', source: 'local', title: null, sealed: false, labels: ['ready-for-agent', 'priority:P1'], parent_number: null, blocked_by: [2], milestone_number: 1 },
      { number: 2, former_number: 58, former_source: 'github', source: 'local', title: null, sealed: false, labels: ['ready-for-agent'], parent_number: null, blocked_by: [], milestone_number: null },
    ]);
    expect(await milestoneRows()).toEqual([{ number: 1, rank: 1, source: 'local', title: null, sealed: false }]);
    expect((await state()).tickets.find((item) => item.number === 1)).toMatchObject({ formerNumber: 57, formerSource: 'github', title: null, titleSealed: null });

    const item = (number: number) => ({
      kind: 'ticket',
      number,
      state: number === 2 ? 'closed' : 'open',
      stateReason: number === 2 ? 'completed' : null,
      readyMark: true,
      labels: ['ready-for-agent'],
      labelsSealed: SEALED,
      branchPrefix: 'feat',
      visualReview: false,
      titleSealed: SEALED,
      milestoneRank: number === 1 ? 1 : null,
      blockedBy: number === 1 ? [2] : [],
      parent: null,
      contentHash: `v1.${'c'.repeat(43)}`,
      createdAt: '2026-11-18T09:00:00.000Z',
      updatedAt: '2026-11-19T09:00:00.000Z',
      closedAt: number === 2 ? '2026-11-19T09:00:00.000Z' : null,
      observedAt: '2026-11-19T09:00:01.000Z',
    });
    socket.send({
      type: 'local.changed',
      projectId,
      vaultKeyVersion: 1,
      full: true,
      items: [item(1), item(2), { kind: 'milestone', rank: 1, titleSealed: SEALED, dueOn: null, observedAt: '2026-11-19T09:00:02.000Z' }],
      unreadable: [],
    } as never);
    await vi.waitFor(async () => expect((await rows()).map((row) => [row.number, row.former_number, row.sealed])).toEqual([
      [1, 57, true],
      [2, 58, true],
    ]));
    expect((await milestoneRows()).map((row) => row.sealed)).toEqual([true]);
  });
});
