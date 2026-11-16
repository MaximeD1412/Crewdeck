import {
  type CodeChange,
  type GitHubMilestone,
  type Issue,
  type PullRequest,
  type Ticket,
  zCodeChange,
  zMilestone,
  zProjectList,
  zState,
  zTicket,
  zTicketDetail,
  zTicketList,
} from '@crewdeck/contracts';
import type { INestApplication } from '@nestjs/common';
import pg from 'pg';
import { inject, vi } from 'vitest';
import { SESSION_COOKIE } from '../../src/auth/cookies.js';
import { WebSessions } from '../../src/auth/web-sessions.js';
import { appOrigin, parseEnv } from '../../src/config/env.js';
import { Reconciliation } from '../../src/github/reconciliation/reconciliation.service.js';
import { WebhookDispatcher } from '../../src/github/webhooks/dispatcher.js';
import { newId } from '../../src/ids.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { ProjectSources } from '../../src/projects/project-sources.js';
import { Transactions } from '../../src/realtime/transactions.js';
import { runInPilotScope } from '../../src/scope/scope.context.js';
import { FAKES, type Fakes } from '../../src/testing/fakes.js';
import type { SeedIssue } from '../../src/testing/fake-github.js';
import { type PullRequestReviewEvent, type TicketCommentEvent, TicketActivity } from '../../src/tickets/ticket-activity.js';
import { type TicketInput, TicketsWriter } from '../../src/tickets/tickets.writer.js';
import { deliverWebhook, TEST_WEBHOOK_SECRET, webhookFixture } from '../fakes/github.js';
import { connect, type WsClient } from '../fakes/ws-client.js';
import { authKeysEnv } from '../github-app.js';
import { expectEnvelope, expectFields, startApp } from '../route-baseline.js';

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

/** What every body, description and comment of the payloads carries: it must reach no table, no event, no log line. */
const MARKER = 'body-marker-4f1c9e-never-stored';

const bytes = (n: number) => Buffer.alloc(n, 7).toString('base64url');
const SEALED = { key: bytes(60), ciphertext: bytes(32) };

/** A webhook of the App's installation on the fixture repository. */
const envelope = (action: string | null, rest: Record<string, unknown>) => ({
  ...(action === null ? {} : { action }),
  installation: { id: INSTALLATION_ID },
  repository: REPOSITORY,
  sender: { id: SENDER_ID, login: 'octo-fixture' },
  ...rest,
});

const milestonePayload = (milestone: GitHubMilestone) => ({
  number: milestone.number,
  title: milestone.title,
  state: milestone.state,
  due_on: milestone.dueOn === null ? null : `${milestone.dueOn}T07:00:00Z`,
  open_issues: milestone.openIssues,
  closed_issues: milestone.closedIssues,
  closed_at: milestone.closedAt,
  description: MARKER,
});

const issuePayload = (issue: Issue, milestone?: GitHubMilestone) => ({
  number: issue.number,
  title: issue.title,
  state: issue.state,
  state_reason: issue.stateReason,
  labels: issue.labels.map((name, index) => ({ id: index + 1, name, color: 'ededed', description: MARKER })),
  milestone: milestone ? milestonePayload(milestone) : null,
  created_at: issue.createdAt,
  closed_at: issue.closedAt,
  updated_at: issue.updatedAt,
  body: MARKER,
  repository_url: REPO_URL,
  user: { login: 'octo-fixture' },
});

const prPayload = (pr: PullRequest) => ({
  number: pr.number,
  title: pr.title,
  state: pr.state,
  draft: pr.draft,
  merged: pr.merged,
  merged_at: pr.mergedAt,
  merge_commit_sha: pr.mergeSha,
  merged_by: pr.mergedBy === null ? null : { login: pr.mergedBy },
  head: { ref: pr.headRef, sha: pr.headSha },
  base: { ref: pr.baseRef },
  labels: [],
  created_at: pr.createdAt,
  updated_at: pr.updatedAt,
  body: MARKER,
});

interface Tab {
  id: string;
  cookie: string;
}

interface EventRow {
  type: string;
  payload: Record<string, unknown>;
  source: string | null;
  tx: string;
}

describe('the Tickets and changes of code against PostgreSQL', () => {
  let app: INestApplication;
  let url: string;
  let prisma: PrismaService;
  let fakes: Fakes;
  let dispatcher: WebhookDispatcher;
  const lines: string[] = [];
  const clients: WsClient[] = [];

  beforeAll(async () => {
    ({ app, url } = await startApp(env, { logs: { write: (line: string) => lines.push(line) } }));
    prisma = app.get(PrismaService);
    fakes = app.get<Fakes>(FAKES);
    dispatcher = app.get(WebhookDispatcher);
  });

  const empty = () => sql('TRUNCATE pilots, github_installations, github_deliveries CASCADE');

  afterAll(async () => {
    await empty();
    await app.close();
  });

  let alice: Tab;
  let projectId: string;

  const pilot = async (githubUserId: number, login: string): Promise<Tab> => {
    const id = newId();
    await sql(`INSERT INTO pilots (id, github_user_id, login, time_zone, getting_started_step) VALUES ($1, $2, $3, 'Europe/Paris', 'projects')`, [id, githubUserId, login]);
    const token = await runInPilotScope(id, () => app.get(WebSessions).open(prisma.scoped, id, undefined));
    return { id, cookie: `${SESSION_COOKIE}=${token}` };
  };

  const deliver = async (event: string, payload: unknown): Promise<void> => {
    const res = await deliverWebhook(url, { event, payload });
    expect(res.status).toBe(202);
    await dispatcher.settled();
  };

  const call = (tab: Tab | undefined, path: string, body?: unknown): Promise<Response> =>
    fetch(`${url}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { ...(tab ? { cookie: tab.cookie } : {}), origin: ORIGIN, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      redirect: 'manual',
    });

  const state = async (tab: Tab = alice) => zState.parse(await (await call(tab, '/api/state')).json());

  const eventsOf = (tab: Tab = alice): Promise<EventRow[]> =>
    sql<EventRow>('SELECT type, payload, source, xmin::text AS tx FROM events WHERE pilot_id = $1 ORDER BY seq', [tab.id]);

  const ticket = async (number: number): Promise<Ticket | undefined> => (await state()).tickets.find((item) => item.number === number);
  const change = async (number: number): Promise<CodeChange | undefined> => (await state()).codeChanges.find((item) => item.number === number);

  beforeEach(async () => {
    await empty();
    fakes.github.reset();
    lines.length = 0;
    alice = await pilot(SENDER_ID, 'octo-fixture');
    fakes.github.seedRepo({ ...APP_REPO, installationId: INSTALLATION_ID, files: { 'README.md': '# App' } });
    await fakes.github.pushCommit(APP_REPO, 'main', { 'src/main.ts': 'code' });
    await deliver('installation', created);
    const repositories = (await state()).repositories;
    const repository = repositories.find((item) => item.name === APP_REPO.name);
    const res = await call(alice, '/api/projects', { repositoryIds: [repository?.id], seq: String((await state()).seq) });
    const [project] = zProjectList.parse(await res.json()).items;
    projectId = project?.id ?? '';
    expect(projectId).not.toBe('');
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(clients.splice(0).map((client) => client.close()));
  });

  /** The issue seeded on the fake GitHub, then its `issues` webhook. */
  const issue = async (action: string, seed: SeedIssue, milestone?: GitHubMilestone): Promise<Issue> => {
    const seeded = fakes.github.seedIssue(APP_REPO, seed);
    await deliver('issues', envelope(action, { issue: issuePayload(seeded, milestone) }));
    return seeded;
  };

  const blockedBy = async (action: 'blocked_by_added' | 'blocked_by_removed', blocked: Issue, blocking: Issue): Promise<void> => {
    fakes.github.seedIssue(APP_REPO, { ...blocked, blockedBy: action === 'blocked_by_added' ? [{ ...APP_REPO, number: blocking.number, state: blocking.state }] : [] });
    await deliver('issue_dependencies', envelope(action, { blocked_issue: issuePayload(blocked), blocking_issue: issuePayload(blocking) }));
  };

  /** A PR opened from `branch` on the fake GitHub, then its `pull_request.opened` webhook. */
  const openPullRequest = async (branch: string, title = 'Connexion GitHub'): Promise<PullRequest> => {
    await fakes.github.pushCommit(APP_REPO, branch, { [`src/${branch.replaceAll('/', '-')}.ts`]: 'change' });
    const pr = await fakes.github.createPullRequest(APP_REPO, { head: branch, base: 'main', title, draft: false });
    await deliver('pull_request', envelope('opened', { number: pr.number, pull_request: prPayload(pr) }));
    return pr;
  };

  const checkRun = (sha: string, name: string, status: 'in_progress' | 'completed', conclusion: 'success' | 'failure' | null = null) =>
    deliver(
      'check_run',
      envelope(status === 'completed' ? 'completed' : 'created', {
        check_run: {
          id: 1,
          name,
          head_sha: sha,
          status,
          conclusion,
          html_url: `https://github.com/${FULL_NAME}/runs/1`,
          started_at: '2026-11-15T10:00:00Z',
          completed_at: status === 'completed' ? '2026-11-15T10:02:30Z' : null,
          output: { title: MARKER, summary: MARKER, text: MARKER },
        },
      }),
    );

  const local = (number: number, rest: Partial<TicketInput> = {}): TicketInput => ({
    number,
    title: null,
    titleSealed: SEALED,
    state: 'open',
    stateReason: null,
    closedAt: null,
    readyMark: true,
    labels: ['ready-for-agent'],
    labelsSealed: SEALED,
    milestoneNumber: null,
    sourceCreatedAt: '2026-11-10T08:00:00.000Z',
    sourceUpdatedAt: '2026-11-10T08:00:00.000Z',
    ...rest,
  });

  const write = <T>(fn: (tx: Parameters<Parameters<Transactions['run']>[0]>[0]) => Promise<T>): Promise<T> =>
    runInPilotScope(alice.id, () => app.get(Transactions).run(fn));

  describe('the issues', () => {
    it('issues.opened with ready-for-agent creates a ready GitHub Ticket, its row and its ticket.upserted written in one transaction, sent to a tab', async () => {
      const client = await connect(url, { cookie: alice.cookie, origin: ORIGIN });
      clients.push(client);
      client.send({ type: 'hello', lastSeq: Number((await state()).seq) });
      await client.next('live');

      await issue('opened', { number: 42, title: 'Connexion GitHub', labels: ['ready-for-agent', 'priority:P1', 'size:S'] });

      const sent = await client.next('event');
      expect(sent.event).toMatchObject({ type: 'ticket.upserted', payload: { number: 42, source: 'github', readyMark: true, ready: true } });
      const tracked = await ticket(42);
      expect(zTicket.parse(tracked)).toMatchObject({ projectId, source: 'github', title: 'Connexion GitHub', titleSealed: null, readyMark: true, ready: true, priority: 'P1', size: 'S', branchPrefix: 'feat', visualReview: false });
      const [row] = await sql<{ tx: string }>('SELECT xmin::text AS tx FROM tickets WHERE number = 42');
      const events = (await eventsOf()).filter((event) => event.type === 'ticket.upserted');
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ source: 'github', tx: row?.tx });
    });

    it('a Ticket blocked by an open Ticket is not ready; closing the blocker makes it ready, with its own ticket.upserted', async () => {
      const blocker = await issue('opened', { number: 12, title: 'Schéma', labels: ['ready-for-agent'] });
      const blocked = await issue('opened', { number: 42, title: 'Connexion GitHub', labels: ['ready-for-agent'] });
      await blockedBy('blocked_by_added', blocked, blocker);
      expect(await ticket(42)).toMatchObject({ blockedBy: [12], ready: false });

      await issue('closed', { ...blocker, state: 'closed', stateReason: 'completed', updatedAt: '2026-11-02T09:00:00.000Z', closedAt: '2026-11-02T09:00:00.000Z' });

      expect(await ticket(12)).toMatchObject({ state: 'closed', stateReason: 'completed', closedAt: '2026-11-02T09:00:00.000Z', ready: false });
      expect(await ticket(42)).toMatchObject({ blockedBy: [12], ready: true });
      const last = (await eventsOf()).slice(-2).map((event) => [event.type, event.payload['number'], event.payload['ready']]);
      expect(last).toEqual([
        ['ticket.upserted', 12, false],
        ['ticket.upserted', 42, true],
      ]);
    });

    it('issue_dependencies.blocked_by_added alone makes the blocked Ticket not ready; blocked_by_removed makes it ready again', async () => {
      const blocker = await issue('opened', { number: 12, title: 'Schéma' });
      const blocked = await issue('opened', { number: 42, title: 'Connexion GitHub', labels: ['ready-for-agent'] });
      expect(await ticket(42)).toMatchObject({ ready: true });

      await blockedBy('blocked_by_added', blocked, blocker);
      expect(await ticket(42)).toMatchObject({ blockedBy: [12], ready: false });

      await blockedBy('blocked_by_removed', blocked, blocker);
      expect(await ticket(42)).toMatchObject({ blockedBy: [], ready: true });
    });

    it('the label needs-human makes a Ticket not ready; removing it makes it ready again', async () => {
      const seeded = await issue('opened', { number: 42, title: 'Connexion GitHub', labels: ['ready-for-agent', 'needs-human'] });
      expect(await ticket(42)).toMatchObject({ readyMark: true, ready: false });

      await issue('unlabeled', { ...seeded, labels: ['ready-for-agent'], updatedAt: '2026-11-02T09:00:00.000Z' });
      expect(await ticket(42)).toMatchObject({ ready: true });
    });

    it('type:fix and revue-visuelle give branchPrefix fix and visualReview; no type:* gives feat; a milestone’s rank is its number', async () => {
      const milestone = fakes.github.seedMilestone(APP_REPO, { number: 7, title: 'MVP', dueOn: '2026-12-01', openIssues: 2 });
      await issue('opened', { number: 42, title: 'Bogue', labels: ['type:fix', 'revue-visuelle'], milestone: { number: 7, title: 'MVP' } }, milestone);
      await issue('opened', { number: 43, title: 'Fonction', labels: ['ready-for-agent'] });

      expect(await ticket(42)).toMatchObject({ branchPrefix: 'fix', visualReview: true, readyMark: false, ready: false, milestoneNumber: 7 });
      expect(await ticket(43)).toMatchObject({ branchPrefix: 'feat', visualReview: false });
      expect((await state()).milestones).toEqual([expect.objectContaining({ number: 7, rank: 7, title: 'MVP', dueOn: '2026-12-01', openCount: 2 })]);
    });

    it('issues.deleted removes the Ticket with ticket.removed', async () => {
      const seeded = await issue('opened', { number: 42, title: 'Connexion GitHub' });
      const id = (await ticket(42))?.id;

      await deliver('issues', envelope('deleted', { issue: issuePayload(seeded) }));

      expect(await ticket(42)).toBeUndefined();
      expect((await eventsOf()).at(-1)).toMatchObject({ type: 'ticket.removed', payload: { id } });
    });

    it('sub_issues.sub_issue_added gives the Ticket its parent', async () => {
      const parent = await issue('opened', { number: 40, title: 'Épopée' });
      const sub = await issue('opened', { number: 42, title: 'Connexion GitHub' });

      await deliver('sub_issues', envelope('sub_issue_added', { sub_issue: issuePayload(sub), parent_issue: issuePayload(parent), parent_issue_id: 1, sub_issue_id: 2 }));

      expect(await ticket(42)).toMatchObject({ parentNumber: 40 });
    });
  });

  describe('the milestones', () => {
    it('milestone.edited changing due_on updates the milestone and sends milestone.upserted', async () => {
      const milestone = fakes.github.seedMilestone(APP_REPO, { number: 3, title: 'MVP', dueOn: '2026-12-01' });
      await deliver('milestone', envelope('created', { milestone: milestonePayload(milestone) }));

      const moved = fakes.github.seedMilestone(APP_REPO, { number: 3, title: 'MVP', dueOn: '2026-12-15' });
      await deliver('milestone', envelope('edited', { milestone: milestonePayload(moved), changes: { due_on: { from: '2026-12-01T07:00:00Z' } } }));

      const [stored] = (await state()).milestones;
      expect(zMilestone.parse(stored)).toMatchObject({ number: 3, rank: 3, dueOn: '2026-12-15' });
      expect((await eventsOf()).at(-1)).toMatchObject({ type: 'milestone.upserted', source: 'github', payload: { number: 3, dueOn: '2026-12-15' } });
    });
  });

  describe('a Local write', () => {
    it('upsertTickets with source local stores the sealed title, keeps the Runner’s figures and computes ready from readyMark and the product’s labels', async () => {
      await write(async (tx) => {
        const writer = app.get(TicketsWriter);
        await writer.upsertMilestones(tx, projectId, 'local', [
          { number: 1, rank: 2, title: null, titleSealed: SEALED, state: 'open', dueOn: null, openCount: 1, closedCount: 0, closedAt: null },
        ]);
        await writer.upsertTickets(tx, projectId, 'local', [
          local(1, { labels: ['ready-for-agent', 'priority:P0', 'client-acme'], branchPrefix: 'chore', visualReview: true, milestoneNumber: 1 }),
          local(2, { labels: ['needs-human'] }),
          local(3, { readyMark: false }),
        ]);
      });

      const tickets = (await state()).tickets;
      expect(tickets.find((item) => item.number === 1)).toMatchObject({
        source: 'local',
        title: null,
        titleSealed: SEALED,
        labels: ['ready-for-agent', 'priority:P0'],
        labelsSealed: SEALED,
        priority: 'P0',
        branchPrefix: 'chore',
        visualReview: true,
        readyMark: true,
        ready: true,
      });
      expect(tickets.find((item) => item.number === 2)).toMatchObject({ readyMark: true, ready: false });
      expect(tickets.find((item) => item.number === 3)).toMatchObject({ readyMark: false, ready: false });
      expect((await state()).milestones).toEqual([expect.objectContaining({ source: 'local', rank: 2, title: null, titleSealed: SEALED })]);
      const event = (await eventsOf()).find((item) => item.type === 'ticket.upserted' && item.payload['number'] === 1);
      expect(event?.payload).toMatchObject({ title: null, titleSealed: SEALED });
      expect(event?.source).toBeNull();
    });

    it('GET /api/state holds the open Tickets and those closed in the last 30 days only', async () => {
      const daysAgo = (days: number) => new Date(Date.now() - days * 24 * 60 * 60_000).toISOString();
      await write((tx) =>
        app.get(TicketsWriter).upsertTickets(tx, projectId, 'local', [
          local(1),
          local(2, { state: 'closed', stateReason: 'completed', closedAt: daysAgo(29) }),
          local(3, { state: 'closed', stateReason: 'completed', closedAt: daysAgo(31) }),
        ]),
      );

      expect((await state()).tickets.map((item) => item.number).sort()).toEqual([1, 2]);
    });

    it('the database refuses a GitHub row with a sealed title and no title', async () => {
      await expect(
        sql(
          `INSERT INTO tickets (id, pilot_id, project_id, source, number, title, title_sealed, state, ready_mark, ready, branch_prefix, visual_review, source_created_at, source_updated_at, updated_at)
           VALUES ($1, $2, $3, 'github', 1, NULL, $4, 'open', false, false, 'feat', false, now(), now(), now())`,
          [newId(), alice.id, projectId, JSON.stringify(SEALED)],
        ),
      ).rejects.toThrow(/tickets_title_by_source/);
    });
  });

  describe('the changes of code', () => {
    it('a PR on feat/42-connexion-github delivers Ticket 42, its state and head; one on another branch delivers none', async () => {
      const pr = await openPullRequest('feat/42-connexion-github');
      const other = await openPullRequest('spike-cache', 'Essai');

      expect(zCodeChange.parse(await change(pr.number))).toMatchObject({ source: 'github', ticketNumber: 42, state: 'open', headRef: 'feat/42-connexion-github', headSha: pr.headSha, checks: 'none' });
      expect(await change(other.number)).toMatchObject({ ticketNumber: null, state: 'open' });
    });

    it('check_run and status on the head move checks from pending to passed or failed; an older SHA’s never change them', async () => {
      const pr = await openPullRequest('feat/42-connexion-github');

      await checkRun(pr.headSha, 'ci', 'in_progress');
      expect(await change(pr.number)).toMatchObject({ checks: 'pending', checksSha: pr.headSha });

      await checkRun(pr.headSha, 'ci', 'completed', 'success');
      expect(await change(pr.number)).toMatchObject({ checks: 'passed' });

      await deliver('status', envelope(null, { sha: pr.headSha, context: 'lint', state: 'failure', target_url: null, description: MARKER }));
      expect(await change(pr.number)).toMatchObject({ checks: 'failed' });
      expect(await sql('SELECT name, state, duration_ms FROM code_change_checks ORDER BY name')).toEqual([
        { name: 'ci', state: 'passed', duration_ms: 150_000 },
        { name: 'lint', state: 'failed', duration_ms: null },
      ]);

      // A push: the new head has no check yet; one arriving late on the old head changes nothing.
      const head = await fakes.github.pushCommit(APP_REPO, 'feat/42-connexion-github', { 'src/more.ts': 'more' });
      const moved = await fakes.github.getPullRequest(APP_REPO, pr.number);
      await deliver('pull_request', envelope('synchronize', { number: pr.number, pull_request: prPayload(moved as PullRequest) }));
      expect(await change(pr.number)).toMatchObject({ headSha: head, checks: 'none', checksSha: head });

      await checkRun(pr.headSha, 'ci', 'completed', 'failure');
      expect(await change(pr.number)).toMatchObject({ headSha: head, checks: 'none' });
    });

    it('a PR merged by crewdeck[bot] is mergedBy loop with its mergeSha; by anyone else, pilot', async () => {
      const byLoop = await openPullRequest('feat/42-connexion-github');
      const byPilot = await openPullRequest('feat/43-autre', 'Autre');

      await fakes.github.mergePullRequest(APP_REPO, byLoop.number, { sha: byLoop.headSha, method: 'squash' });
      const merged = (await fakes.github.getPullRequest(APP_REPO, byLoop.number)) as PullRequest;
      await deliver('pull_request', envelope('closed', { number: byLoop.number, pull_request: prPayload(merged) }));
      const byHand = fakes.github.mergeByHand(APP_REPO, byPilot.number, 'octo-fixture');
      await deliver('pull_request', envelope('closed', { number: byPilot.number, pull_request: prPayload(byHand) }));

      expect(await change(byLoop.number)).toMatchObject({ state: 'merged', mergedBy: 'loop', mergeSha: merged.mergeSha, mergedAt: expect.any(String) });
      expect(await change(byPilot.number)).toMatchObject({ state: 'merged', mergedBy: 'pilot', mergeSha: byHand.mergeSha });
    });
  });

  describe('the Sources', () => {
    it('writes nothing for a Projet whose groups are not on GitHub', async () => {
      await sql(`UPDATE artifact_sources SET source = 'local'`);
      const before = (await eventsOf()).length;

      await issue('opened', { number: 42, title: 'Connexion GitHub', labels: ['ready-for-agent'] });
      await openPullRequest('feat/42-connexion-github');

      expect(await sql('SELECT id FROM tickets UNION ALL SELECT id FROM code_changes')).toEqual([]);
      expect(await eventsOf()).toHaveLength(before);
    });

    it('takes a comment of a PR on the group of the code and one of an issue on that of the Tickets', async () => {
      const comments: TicketCommentEvent[] = [];
      app.get(TicketActivity).onComment((event) => void comments.push(event));
      const seeded = await issue('opened', { number: 42, title: 'Connexion GitHub' });
      vi.spyOn(app.get(ProjectSources), 'isGithub').mockImplementation(async (_id, group) => group === 'code');
      const comment = (id: number) => ({ id, body: MARKER, user: { login: 'octo-fixture' }, created_at: '2026-11-15T10:00:00Z' });

      await deliver('issue_comment', envelope('created', { issue: issuePayload(seeded), comment: comment(801) }));
      await deliver('issue_comment', envelope('created', { issue: { ...issuePayload({ ...seeded, number: 57 }), pull_request: { url: `${REPO_URL}/pulls/57` } }, comment: comment(802) }));

      expect(comments).toEqual([expect.objectContaining({ issueNumber: 57, commentId: 802, isPullRequest: true })]);
    });
  });

  describe('the bodies', () => {
    it('leaves the marker of the bodies in no table, no event and no log line; comments and reviews go out without their text', async () => {
      const comments: TicketCommentEvent[] = [];
      const reviews: PullRequestReviewEvent[] = [];
      app.get(TicketActivity).onComment((event) => void comments.push(event));
      app.get(TicketActivity).onReview((event) => void reviews.push(event));
      const milestone = fakes.github.seedMilestone(APP_REPO, { number: 3, title: 'MVP' });
      const seeded = await issue('opened', { number: 42, title: 'Connexion GitHub', body: MARKER, milestone: { number: 3, title: 'MVP' } }, milestone);
      await deliver('milestone', envelope('created', { milestone: milestonePayload(milestone) }));
      await deliver(
        'issue_comment',
        envelope('created', { issue: issuePayload(seeded), comment: { id: 801, body: MARKER, user: { login: 'octo-fixture' }, created_at: '2026-11-15T10:00:00Z' } }),
      );
      const pr = await openPullRequest('feat/42-connexion-github');
      await deliver(
        'pull_request_review',
        envelope('submitted', { pull_request: prPayload(pr), review: { id: 901, state: 'changes_requested', body: MARKER, user: { login: 'octo-fixture' }, commit_id: pr.headSha } }),
      );
      await checkRun(pr.headSha, 'ci', 'completed', 'failure');

      expect(comments).toEqual([{ projectId, issueNumber: 42, commentId: 801, author: 'octo-fixture', isPullRequest: false, createdAt: '2026-11-15T10:00:00.000Z' }]);
      expect(reviews).toEqual([{ projectId, prNumber: pr.number, reviewer: 'octo-fixture', state: 'changes_requested', commitId: pr.headSha }]);
      expect(await ticket(42)).toBeDefined();
      const tables = await sql<{ name: string }>(`SELECT tablename AS name FROM pg_tables WHERE schemaname = 'public'`);
      for (const { name } of tables) {
        const found = await sql(`SELECT 1 FROM "${name}" t WHERE t::text LIKE $1`, [`%${MARKER}%`]);
        expect(found, name).toEqual([]);
      }
      expect(lines.length).toBeGreaterThan(0);
      expect(lines.filter((line) => line.includes(MARKER))).toEqual([]);
    });
  });

  describe('the reconciliation', () => {
    it('alone brings a Ticket, its blocked-by, its milestone’s counts and its PR with its checks to the right state, then what changed since', async () => {
      fakes.github.seedMilestone(APP_REPO, { number: 3, title: 'MVP', openIssues: 2, closedIssues: 1 });
      fakes.github.seedIssue(APP_REPO, { number: 12, title: 'Schéma' });
      fakes.github.seedIssue(APP_REPO, { number: 42, title: 'Connexion GitHub', labels: ['ready-for-agent'], milestone: { number: 3, title: 'MVP' }, blockedBy: [{ ...APP_REPO, number: 12, state: 'open' }] });
      await fakes.github.pushCommit(APP_REPO, 'feat/42-connexion-github', { 'src/login.ts': 'login' });
      const pr = await fakes.github.createPullRequest(APP_REPO, { head: 'feat/42-connexion-github', base: 'main', title: 'Connexion GitHub', draft: false });
      fakes.github.setCheckRuns(APP_REPO, pr.headSha, [{ id: 1, name: 'ci', status: 'completed', conclusion: 'success' }]);

      await app.get(Reconciliation).run();

      expect(await ticket(42)).toMatchObject({ source: 'github', blockedBy: [12], milestoneNumber: 3, readyMark: true, ready: false });
      expect((await state()).milestones).toEqual([expect.objectContaining({ number: 3, openCount: 2, closedCount: 1 })]);
      expect(await change(pr.number)).toMatchObject({ ticketNumber: 42, state: 'open', headSha: pr.headSha, checks: 'passed' });

      // What changed on GitHub while no webhook came: the blocker closed, the PR merged, the milestone deleted.
      const later = new Date(Date.now() + 1000).toISOString();
      fakes.github.seedIssue(APP_REPO, { number: 12, title: 'Schéma', state: 'closed', updatedAt: later, closedAt: later });
      const merged = fakes.github.mergeByHand(APP_REPO, pr.number, 'octo-fixture');
      await app.get(Reconciliation).run();

      expect(await ticket(12)).toMatchObject({ state: 'closed' });
      expect(await ticket(42)).toMatchObject({ ready: true });
      expect(await change(pr.number)).toMatchObject({ state: 'merged', mergedBy: 'pilot', mergeSha: merged.mergeSha });
    });

    it('brings the checks of a PR merged while no webhook came to the state of its head', async () => {
      await fakes.github.pushCommit(APP_REPO, 'feat/42-connexion-github', { 'src/login.ts': 'login' });
      const pr = await fakes.github.createPullRequest(APP_REPO, { head: 'feat/42-connexion-github', base: 'main', title: 'Connexion GitHub', draft: false });
      fakes.github.setCheckRuns(APP_REPO, pr.headSha, [{ id: 1, name: 'ci', status: 'in_progress', conclusion: null }]);
      await app.get(Reconciliation).run();
      expect(await change(pr.number)).toMatchObject({ state: 'open', checks: 'pending' });

      // The checks passed, then the PR merged, their webhooks lost.
      fakes.github.setCheckRuns(APP_REPO, pr.headSha, [{ id: 1, name: 'ci', status: 'completed', conclusion: 'success' }]);
      fakes.github.mergeByHand(APP_REPO, pr.number, 'octo-fixture');
      await app.get(Reconciliation).run();

      expect(await change(pr.number)).toMatchObject({ state: 'merged', checks: 'passed', checksSha: pr.headSha });
    });

    it('brings the checks of a PR whose merge came but not the end of its checks to the state of its head', async () => {
      const pr = await openPullRequest('feat/42-connexion-github');
      await checkRun(pr.headSha, 'ci', 'in_progress');
      // The checks passed, their webhook lost; the merge's came.
      fakes.github.setCheckRuns(APP_REPO, pr.headSha, [{ id: 1, name: 'ci', status: 'completed', conclusion: 'success' }]);
      const merged = fakes.github.mergeByHand(APP_REPO, pr.number, 'octo-fixture');
      await deliver('pull_request', envelope('closed', { number: pr.number, pull_request: prPayload(merged) }));
      expect(await change(pr.number)).toMatchObject({ state: 'merged', checks: 'pending' });

      await app.get(Reconciliation).run();

      expect(await change(pr.number)).toMatchObject({ state: 'merged', checks: 'passed', checksSha: pr.headSha });
    });

    it('brings a parent set before the Projet was followed, then its removal while no webhook came', async () => {
      fakes.github.seedIssue(APP_REPO, { number: 42, title: 'Connexion GitHub' });
      fakes.github.seedIssue(APP_REPO, { number: 7, title: 'Authentification', subIssues: [42] });
      await app.get(Reconciliation).run();
      expect(await ticket(42)).toMatchObject({ parentNumber: 7 });

      const later = new Date(Date.now() + 1000).toISOString();
      fakes.github.seedIssue(APP_REPO, { number: 7, title: 'Authentification', subIssues: [], updatedAt: later });
      fakes.github.seedIssue(APP_REPO, { number: 42, title: 'Connexion GitHub', updatedAt: later });
      await app.get(Reconciliation).run();

      expect(await ticket(42)).toMatchObject({ parentNumber: null });
    });

    it('writes nothing when it finds the Tickets as they are', async () => {
      fakes.github.seedIssue(APP_REPO, { number: 42, title: 'Connexion GitHub', labels: ['ready-for-agent'] });
      await app.get(Reconciliation).run();
      const before = (await eventsOf()).length;

      await app.get(Reconciliation).run();

      expect(await eventsOf()).toHaveLength(before);
    });
  });

  describe('GET /api/projects/:id/tickets', () => {
    const tickets = (tab: Tab | undefined, query = '', id = projectId) => call(tab, `/api/projects/${id}/tickets${query}`);

    it('returns the Projet’s Tickets by number descending, 50 per page, then the next page from nextCursor', async () => {
      await write((tx) =>
        app.get(TicketsWriter).upsertTickets(
          tx,
          projectId,
          'github',
          Array.from({ length: 55 }, (_, index) => ({ ...local(index + 1), title: `Ticket ${index + 1}`, titleSealed: null, labelsSealed: null, state: index < 5 ? ('closed' as const) : ('open' as const), closedAt: index < 5 ? '2026-11-14T08:00:00.000Z' : null, stateReason: index < 5 ? ('completed' as const) : null })),
        ),
      );

      const first = await tickets(alice);
      expect(first.status).toBe(200);
      const page = zTicketList.parse(await first.json());
      expect(page.items.map((item) => item.number)).toEqual(Array.from({ length: 50 }, (_, index) => 55 - index));
      expect(page.nextCursor).not.toBeNull();
      const next = zTicketList.parse(await (await tickets(alice, `?cursor=${page.nextCursor}`)).json());
      expect(next.items.map((item) => item.number)).toEqual([5, 4, 3, 2, 1]);
      expect(next.nextCursor).toBeNull();
      const closed = zTicketList.parse(await (await tickets(alice, '?state=closed')).json());
      expect(closed.items.map((item) => item.number)).toEqual([5, 4, 3, 2, 1]);
    });

    it('is 400 with fields on a bad state or cursor, 401 without a session, 404 for another Pilote’s Projet or an unknown one', async () => {
      await expectFields(await tickets(alice, '?state=ready'), ['state']);
      await expectFields(await tickets(alice, '?cursor=nope'), ['cursor']);
      await expectEnvelope(await tickets(undefined), 401, 'auth.required');
      const bob = await pilot(9100002, 'bob-fixture');
      await expectEnvelope(await tickets(bob), 404, 'project.not-found');
      await expectEnvelope(await tickets(alice, '', newId()), 404, 'project.not-found');
      await expectEnvelope(await tickets(alice, '', 'not-an-id'), 404, 'project.not-found');
    });

    it('GET :number returns the Ticket, its changes of code and the checks of the latest one’s head; 404 for an unknown number', async () => {
      await issue('opened', { number: 42, title: 'Connexion GitHub', labels: ['ready-for-agent'] });
      const pr = await openPullRequest('feat/42-connexion-github');
      await checkRun(pr.headSha, 'ci', 'completed', 'success');

      const res = await tickets(alice, '/42');
      expect(res.status).toBe(200);
      const detail = zTicketDetail.parse(await res.json());
      expect(detail.ticket).toMatchObject({ number: 42 });
      expect(detail.codeChanges.map((item) => item.number)).toEqual([pr.number]);
      expect(detail.checks).toEqual([expect.objectContaining({ name: 'ci', state: 'passed', sha: pr.headSha, durationMs: 150_000 })]);
      await expectEnvelope(await tickets(alice, '/999'), 404, 'ticket.not-found');
      await expectEnvelope(await tickets(alice, '/abc'), 404, 'ticket.not-found');
      const bob = await pilot(9100002, 'bob-fixture');
      await expectEnvelope(await tickets(bob, '/42'), 404, 'project.not-found');
    });
  });
});
