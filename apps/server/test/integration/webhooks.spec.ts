import { type INestApplication, Injectable, Module, type OnModuleInit } from '@nestjs/common';
import pg from 'pg';
import { inject } from 'vitest';
import { parseEnv } from '../../src/config/env.js';
import { type ReconcileTarget, ReconcileHooks, Reconciliation } from '../../src/github/reconciliation/reconciliation.service.js';
import { GitHubDeliveries } from '../../src/github/webhooks/deliveries.js';
import { type GitHubEvent, GitHubEvents, WebhookDispatcher } from '../../src/github/webhooks/dispatcher.js';
import { newId } from '../../src/ids.js';
import { currentPilotId } from '../../src/scope/scope.context.js';
import { FAKES, type Fakes } from '../../src/testing/fakes.js';
import { deliverWebhook, signWebhook, TEST_WEBHOOK_SECRET, webhookFixture } from '../fakes/github.js';
import { authKeysEnv } from '../github-app.js';
import { expectEnvelope, startApp } from '../route-baseline.js';

const databaseUrl = inject('databaseUrl');
const APP_URL = 'https://crewdeck.example';

const sql = async <T extends pg.QueryResultRow>(text: string, values: unknown[] = []): Promise<T[]> => {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    return (await client.query<T>(text, values)).rows;
  } finally {
    await client.end();
  }
};

/**
 * A transaction of another client holding `text` uncommitted: a statement of
 * the server that conflicts with it waits on its lock until `release()`
 * (rolled back). How the tests order two writes of the server.
 */
const holding = async (text: string, values: unknown[] = []): Promise<{ release: () => Promise<void> }> => {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  await client.query('BEGIN');
  await client.query(text, values);
  return {
    release: async () => {
      await client.query('ROLLBACK');
      await client.end();
    },
  };
};

/** Resolves once a statement of the server waits on a lock that `holding` took. */
const waitingOnALock = () =>
  vi.waitFor(
    async () => {
      const [row] = await sql<{ n: number }>(`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`);
      expect(row?.n).toBeGreaterThan(0);
    },
    { timeout: 5000, interval: 20 },
  );

interface Seen {
  readonly handler: string;
  readonly event: Omit<GitHubEvent<string | null>, 'payload'>;
  /** The Pilote of the scope the handler ran in, `null` outside any. */
  readonly scope: string | null;
}

const scopeOf = (): string | null => {
  try {
    return currentPilotId();
  } catch {
    return null;
  }
};

/** What a module subscribing to the webhooks does, with what the tests need to see it. */
@Injectable()
class ProbeHandlers implements OnModuleInit {
  readonly seen: Seen[] = [];
  /** Called before a handler records: a test makes it wait or throw. */
  before: (handler: string, event: GitHubEvent<string | null>) => void | Promise<void> = () => undefined;

  constructor(private readonly events: GitHubEvents) {}

  onModuleInit(): void {
    const record = (handler: string) => async (event: GitHubEvent<string | null>) => {
      await this.before(handler, event);
      const { deliveryId, pilotId, installationId, event: name, action, sourceAt } = event;
      this.seen.push({ handler, event: { deliveryId, pilotId, installationId, event: name, action, sourceAt }, scope: scopeOf() });
    };
    this.events.on('installation', record('installation'));
    this.events.on('issues', record('issues:first'));
    this.events.on('issues', record('issues:second'));
  }
}

@Module({ providers: [ProbeHandlers] })
class ProbeModule {}

/** The Pilote of the fixtures: the GitHub user who installs the App in `installation.created.json`. */
const SENDER = { id: 9100001, login: 'octo-fixture', avatarUrl: 'https://avatars.example/u/9100001' };
const INSTALLATION_ID = 51000001;

const created = webhookFixture<Record<string, unknown> & { installation: Record<string, unknown> }>('installation.created');
/** `installation.created` of another installation, by `sender` (the fixtures' by default). */
const createdAs = (installationId: number, sender?: { id: number; login: string }) => ({
  ...created,
  installation: { ...created.installation, id: installationId },
  ...(sender ? { sender } : {}),
});
const deleted = webhookFixture('installation.deleted');
const installationAction = (action: string) => ({ ...created, action });
/** An `issues` event of the fixtures' installation, with a body no log may show. */
const issueOpened = (number = 1) => ({
  action: 'opened',
  issue: { number, title: `Ticket ${number}`, state: 'open', body: `secret-issue-body-${number}-5d1c`, labels: [] },
  repository: { id: 71000001, full_name: 'octo-fixture/fixture-app' },
  installation: { id: INSTALLATION_ID },
  sender: { id: SENDER.id, login: SENDER.login },
});

describe('GitHub webhooks against PostgreSQL', () => {
  let app: INestApplication;
  let url: string;
  let probe: ProbeHandlers;
  let dispatcher: WebhookDispatcher;
  let fakes: Fakes;
  const lines: string[] = [];

  beforeAll(async () => {
    const env = parseEnv({
      CREWDECK_ENV: 'test',
      DATABASE_URL: databaseUrl,
      CREWDECK_FAKES: '1',
      PUBLIC_URL: APP_URL,
      GITHUB_WEBHOOK_SECRET: TEST_WEBHOOK_SECRET,
      ...authKeysEnv(),
    });
    ({ app, url } = await startApp(env, { imports: [ProbeModule], logs: { write: (line: string) => lines.push(line) } }));
    probe = app.get(ProbeHandlers);
    dispatcher = app.get(WebhookDispatcher);
    fakes = app.get<Fakes>(FAKES);
  });

  const empty = () => sql('TRUNCATE pilots, github_installations, github_deliveries CASCADE');

  afterAll(async () => {
    await empty();
    await app.close();
  });

  let pilotId: string;

  beforeEach(async () => {
    await empty();
    probe.seen.length = 0;
    probe.before = () => undefined;
    lines.length = 0;
    pilotId = newId();
    await sql(`INSERT INTO pilots (id, display_name, time_zone) VALUES ($1, $2, 'Europe/Paris')`, [pilotId, SENDER.login]);
    await sql(`INSERT INTO pilot_identities (id, pilot_id, provider, subject, login) VALUES ($1, $2, 'github', $3, $4)`, [newId(), pilotId, String(SENDER.id), SENDER.login]);
  });

  const deliver = async (event: string, payload: unknown, deliveryId?: string): Promise<Response> => {
    const res = await deliverWebhook(url, { event, payload, ...(deliveryId ? { deliveryId } : {}) });
    await dispatcher.settled();
    return res;
  };

  /** The fixtures' sender signs in with GitHub: their Pilote, created by this sign-in. */
  const signIn = async (): Promise<{ id: string } | undefined> => {
    fakes.github.reset();
    fakes.github.seedUser(SENDER);
    const start = await fetch(`${url}/api/auth/github/start?timeZone=Europe/Paris`, { redirect: 'manual' });
    const state = new URL(start.headers.get('location') ?? '', url).searchParams.get('state') ?? '';
    const oauth = start.headers.getSetCookie().find((line) => line.startsWith('crewdeck_oauth='))?.split(';')[0] ?? '';
    const callback = await fetch(`${url}/api/auth/github/callback?${new URLSearchParams({ code: 'fake-code', state })}`, { redirect: 'manual', headers: { cookie: oauth } });
    expect(callback.status).toBe(302);
    const [pilot] = await sql<{ id: string }>(
      `SELECT pilot_id AS id FROM pilot_identities WHERE provider = 'github' AND subject = $1`,
      [String(SENDER.id)],
    );
    return pilot;
  };

  const installations = () =>
    sql<{ installation_id: string; account_login: string; account_id: string; sender_id: string; pilot_id: string | null; suspended: boolean }>(
      'SELECT installation_id, account_login, account_id, sender_id, pilot_id, suspended FROM github_installations',
    );

  describe('installation.created', () => {
    it('by a known Pilote: answers 202, indexes the installation linked to them, and runs the installation handler in their scope', async () => {
      const res = await deliver('installation', created);

      expect(res.status).toBe(202);
      expect(await res.json()).toEqual({ accepted: true });
      expect(await installations()).toEqual([
        { installation_id: String(INSTALLATION_ID), account_login: 'octo-fixture', account_id: '9100001', sender_id: '9100001', pilot_id: pilotId, suspended: false },
      ]);
      expect(probe.seen).toEqual([
        {
          handler: 'installation',
          event: expect.objectContaining({ pilotId, installationId: INSTALLATION_ID, event: 'installation', action: 'created' }),
          scope: pilotId,
        },
      ]);
    });

    it('by an unknown GitHub user: kept unlinked, its handlers but installation’s skipped, then linked at that user’s sign-in', async () => {
      await sql('TRUNCATE pilots CASCADE');

      await deliver('installation', created);
      await deliver('issues', issueOpened());

      expect(await installations()).toEqual([expect.objectContaining({ pilot_id: null })]);
      expect(probe.seen).toEqual([{ handler: 'installation', event: expect.objectContaining({ pilotId: null, action: 'created' }), scope: null }]);

      const pilot = await signIn();

      expect(await installations()).toEqual([expect.objectContaining({ pilot_id: pilot?.id })]);
      probe.seen.length = 0;
      await deliver('issues', issueOpened(2));
      expect(probe.seen.map(({ handler, scope }) => ({ handler, scope }))).toEqual([
        { handler: 'issues:first', scope: pilot?.id },
        { handler: 'issues:second', scope: pilot?.id },
      ]);
    });

    it('never links an installation of another GitHub user at a sign-in', async () => {
      await deliver('installation', { ...created, sender: { id: 9100777, login: 'someone-else' } });

      expect(await installations()).toEqual([expect.objectContaining({ pilot_id: null, sender_id: '9100777' })]);
    });

    it('is linked when its sender signs in while it is being indexed', async () => {
      await sql('TRUNCATE pilots CASCADE');
      // `created` has read that its sender is no Pilote, and its write waits: the sign-in runs in between.
      const lock = await holding(
        `INSERT INTO github_installations (installation_id, account_login, account_id, sender_id) VALUES ($1, 'octo-fixture', 9100001, 9100001)`,
        [INSTALLATION_ID],
      );
      expect((await deliverWebhook(url, { event: 'installation', payload: created })).status).toBe(202);
      await waitingOnALock();
      const pilot = await signIn();
      await lock.release();
      await dispatcher.settled();

      expect(await installations()).toEqual([expect.objectContaining({ pilot_id: pilot?.id })]);
    });
  });

  it('installation.deleted removes it, after its handler ran with its Pilote', async () => {
    await deliver('installation', created);
    probe.seen.length = 0;

    expect((await deliver('installation', deleted)).status).toBe(202);

    expect(await installations()).toEqual([]);
    expect(probe.seen).toEqual([{ handler: 'installation', event: expect.objectContaining({ pilotId, action: 'deleted' }), scope: pilotId }]);
  });

  it('dispatches in the order of reception even when the first delivery’s record ends last', async () => {
    const createdId = 'b6b5c2f0-1111-4c3d-9e8f-0000000000c1';
    // The record of `created` waits on this lock; `deleted`, received after, is recorded first.
    const lock = await holding(`INSERT INTO github_deliveries (delivery_id, event) VALUES ($1, 'installation')`, [createdId]);
    const first = deliverWebhook(url, { event: 'installation', payload: created, deliveryId: createdId });
    await waitingOnALock();
    expect((await deliverWebhook(url, { event: 'installation', payload: deleted })).status).toBe(202);
    await lock.release();
    expect((await first).status).toBe(202);
    await dispatcher.settled();

    expect(probe.seen.map((seen) => seen.event.action)).toEqual(['created', 'deleted']);
    expect(await installations()).toEqual([]);
  });

  it('installation.suspend and unsuspend set suspended', async () => {
    await deliver('installation', created);

    await deliver('installation', installationAction('suspend'));
    expect(await installations()).toEqual([expect.objectContaining({ suspended: true })]);

    await deliver('installation', installationAction('unsuspend'));
    expect(await installations()).toEqual([expect.objectContaining({ suspended: false })]);
  });

  describe('an event of a linked installation', () => {
    beforeEach(async () => {
      await deliver('installation', created);
      probe.seen.length = 0;
    });

    it('is dispatched to each handler of its event, in the scope of the installation’s Pilote, with its reception time', async () => {
      const before = Date.now();
      const deliveryId = 'b6b5c2f0-1111-4c3d-9e8f-000000000001';

      expect((await deliver('issues', issueOpened(), deliveryId)).status).toBe(202);

      const event = { deliveryId, pilotId, installationId: INSTALLATION_ID, event: 'issues', action: 'opened', sourceAt: expect.any(Date) };
      expect(probe.seen).toEqual([
        { handler: 'issues:first', event, scope: pilotId },
        { handler: 'issues:second', event, scope: pilotId },
      ]);
      const sourceAt = probe.seen[0]?.event.sourceAt.getTime() ?? 0;
      expect(sourceAt).toBeGreaterThanOrEqual(before - 5);
      expect(sourceAt).toBeLessThanOrEqual(Date.now());
    });

    it('with the same X-GitHub-Delivery twice is dispatched once, the second answered 200 { duplicate: true }', async () => {
      const deliveryId = 'b6b5c2f0-1111-4c3d-9e8f-000000000002';

      expect((await deliver('issues', issueOpened(), deliveryId)).status).toBe(202);
      const again = await deliver('issues', issueOpened(), deliveryId);

      expect(again.status).toBe(200);
      expect(await again.json()).toEqual({ duplicate: true });
      expect(probe.seen.filter((seen) => seen.handler === 'issues:first')).toHaveLength(1);
      expect(await sql('SELECT delivery_id, event FROM github_deliveries WHERE delivery_id = $1', [deliveryId])).toEqual([{ delivery_id: deliveryId, event: 'issues' }]);
    });

    it('sent twice at once is dispatched once', async () => {
      const deliveryId = 'b6b5c2f0-1111-4c3d-9e8f-000000000003';

      const statuses = await Promise.all([1, 2, 3].map(() => deliverWebhook(url, { event: 'issues', payload: issueOpened(), deliveryId }).then((res) => res.status)));
      await dispatcher.settled();

      expect(statuses.sort()).toEqual([200, 200, 202]);
      expect(probe.seen.filter((seen) => seen.handler === 'issues:first')).toHaveLength(1);
    });

    it('runs in the order of reception for its installation, even when a handler is slow', async () => {
      let release!: () => void;
      const released = new Promise<void>((resolve) => (release = resolve));
      probe.before = (handler, event) => (handler === 'issues:first' && (event.payload['issue'] as { number: number }).number === 1 ? released : undefined);

      expect((await deliverWebhook(url, { event: 'issues', payload: issueOpened(1) })).status).toBe(202);
      expect((await deliverWebhook(url, { event: 'issues', payload: issueOpened(2) })).status).toBe(202);
      expect(probe.seen).toEqual([]);
      release();
      await dispatcher.settled();

      expect(probe.seen.map((seen) => seen.handler)).toEqual(['issues:first', 'issues:second', 'issues:first', 'issues:second']);
      expect(probe.seen.map((seen) => seen.event.deliveryId)).toEqual([...new Set(probe.seen.map((seen) => seen.event.deliveryId))].flatMap((id) => [id, id]));
    });

    it('logs a handler’s exception by delivery id and event name, never the payload, and runs the other handlers', async () => {
      const deliveryId = 'b6b5c2f0-1111-4c3d-9e8f-000000000004';
      probe.before = (handler, event) => {
        // What a careless handler might throw: the payload in its message and as a property of the error.
        const issue = event.payload['issue'] as { body: string };
        if (handler === 'issues:first') throw Object.assign(new Error(`cannot read ${issue.body}\n    at secret-frame-9f1e (/x.js:1:2)`), { details: event.payload, code: 'probe.failed' });
      };

      expect((await deliver('issues', issueOpened(7), deliveryId)).status).toBe(202);

      expect(probe.seen.map((seen) => seen.handler)).toEqual(['issues:second']);
      const failure = lines.map((line) => JSON.parse(line) as Record<string, unknown>).find((line) => line['msg'] === 'webhook handler failed');
      expect(failure).toMatchObject({ deliveryId, event: 'issues', action: 'opened', installationId: INSTALLATION_ID, err: { type: 'Error', code: 'probe.failed' } });
      expect((failure?.['err'] as { stack: string }).stack).toContain('webhooks.spec.ts');
      const output = lines.join('');
      for (const secret of ['secret-issue-body-7-5d1c', 'secret-frame-9f1e', 'Ticket 7', 'fixture-app']) expect(output).not.toContain(secret);
    });
  });

  it('dispatches no handler but installation’s for an installation the index does not know', async () => {
    await deliver('issues', { ...issueOpened(), installation: { id: 51000999 } });

    expect(probe.seen).toEqual([]);
  });

  it('records nothing for a bad signature, and nothing for a ping', async () => {
    const res = await deliverWebhook(url, { event: 'issues', payload: issueOpened(), signature: signWebhook('another body') });
    await expectEnvelope(res, 401, 'github.bad-signature');
    expect((await deliver('ping', webhookFixture('ping'))).status).toBe(200);

    expect(await sql('SELECT * FROM github_deliveries')).toEqual([]);
    expect(probe.seen).toEqual([]);
  });

  it('writes no log line with a webhook’s payload, whatever its outcome', async () => {
    await deliver('installation', created);
    probe.before = (handler) => {
      if (handler === 'issues:second') throw new Error('the handler failed');
    };
    const payload = issueOpened(9);

    await deliver('issues', payload);
    await deliverWebhook(url, { event: 'issues', payload, signature: signWebhook('another body') });
    await deliver('issues', { ...payload, installation: { id: 51000999 } });
    await vi.waitFor(() => expect(lines.join('')).toContain('/api/github/webhooks'));

    const output = lines.join('');
    expect(output).toContain('webhook handler failed');
    for (const secret of ['secret-issue-body-9-5d1c', 'Ticket 9', 'fixture-app', JSON.stringify(payload)]) expect(output).not.toContain(secret);
  });

  it('reconciles the linked, unsuspended installations only, each in its Pilote’s scope', async () => {
    const otherPilot = newId();
    await sql(`INSERT INTO pilots (id, display_name, time_zone) VALUES ($1, 'octo-other', 'UTC')`, [otherPilot]);
    await sql(`INSERT INTO pilot_identities (id, pilot_id, provider, subject, login) VALUES ($1, $2, 'github', '9100002', 'octo-other')`, [newId(), otherPilot]);
    await deliver('installation', created);
    await deliver('installation', createdAs(51000002, { id: 9100002, login: 'octo-other' }));
    await deliver('installation', createdAs(51000003, { id: 9100777, login: 'someone-else' }));
    await deliver('installation', { ...createdAs(51000002), action: 'suspend' });
    const reconciled: (ReconcileTarget & { scope: string | null })[] = [];
    app.get(ReconcileHooks).register({ key: 'probe', reconcile: (target) => void reconciled.push({ ...target, scope: scopeOf() }) });

    expect(await app.get(Reconciliation).run()).toBe(true);

    expect(reconciled).toEqual([{ pilotId, installationId: INSTALLATION_ID, scope: pilotId }]);
  });

  it('prunes the deliveries older than 7 days', async () => {
    const now = new Date('2026-11-20T04:10:00Z');
    await sql(
      `INSERT INTO github_deliveries (delivery_id, event, received_at) VALUES
        ('old', 'issues', $1), ('edge', 'issues', $2), ('recent', 'issues', $3)`,
      [new Date(now.getTime() - 8 * 86_400_000), new Date(now.getTime() - 7 * 86_400_000 + 1000), new Date(now.getTime() - 3_600_000)],
    );

    expect(await app.get(GitHubDeliveries).prune(now)).toBe(1);

    expect((await sql<{ delivery_id: string }>('SELECT delivery_id FROM github_deliveries ORDER BY delivery_id')).map((row) => row.delivery_id)).toEqual([
      'edge',
      'recent',
    ]);
  });
});
