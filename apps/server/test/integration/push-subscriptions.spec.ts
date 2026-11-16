import { createECDH, randomBytes } from 'node:crypto';
import { type PushPayload, zPushSubscription, zPushSubscriptionList, zState } from '@crewdeck/contracts';
import type { INestApplication } from '@nestjs/common';
import pg from 'pg';
import { inject, type MockInstance } from 'vitest';
import { SESSION_COOKIE } from '../../src/auth/cookies.js';
import { WebSessions } from '../../src/auth/web-sessions.js';
import { appOrigin, parseEnv } from '../../src/config/env.js';
import { DecisionsService, type RaiseInput } from '../../src/decisions/decisions.service.js';
import { newId } from '../../src/ids.js';
import { PushDelivery } from '../../src/notifications/push-delivery.js';
import { InertPushSender, type PushOutcome, PushSender } from '../../src/notifications/push-sender.js';
import { PushSubscriptions, type PushTarget } from '../../src/notifications/push-subscriptions.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { TabPresence } from '../../src/realtime/tab-presence.js';
import { Transactions } from '../../src/realtime/transactions.js';
import { runInPilotScope } from '../../src/scope/scope.context.js';
import { SettingsService } from '../../src/settings/settings.service.js';
import { expectEnvelope, expectFields, startApp } from '../route-baseline.js';

const databaseUrl = inject('databaseUrl');
const env = parseEnv({ CREWDECK_ENV: 'test', DATABASE_URL: databaseUrl });

const sql = async <T extends pg.QueryResultRow>(text: string, values: unknown[] = []): Promise<T[]> => {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    return (await client.query<T>(text, values)).rows;
  } finally {
    await client.end();
  }
};

const PROJECT = '019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6a02';

const BLOCKED: RaiseInput = {
  kind: 'ticket-blocked',
  projectId: PROJECT,
  projectName: 'Crewdeck',
  subjectType: 'ticket',
  subjectId: '42',
  label: '#42 Connexion GitHub',
  metaParts: ['Code'],
  tone: 'halt',
  link: '/boucle?ticket=42',
  params: { number: 42 },
};

/**
 * A browser's subscription as `PushManager.subscribe` gives it: a P-256
 * public key, 16 bytes of secret. Its endpoint is a push service's, never
 * requested: the sender of `CREWDECK_ENV=test` is inert, and a spy here.
 */
const browser = (label = 'Safari · iPhone') => ({
  endpoint: `https://fcm.googleapis.com/fcm/send/${newId()}`,
  keys: { p256dh: createECDH('prime256v1').generateKeys().toString('base64url'), auth: randomBytes(16).toString('base64url') },
  label,
});

/** The push notifications (ATOI-4): the routes of the subscriptions, then the pushes of the Décisions, the push service a spy. */
describe('the push notifications against PostgreSQL', () => {
  let app: INestApplication;
  let url: string;
  let send: MockInstance<(target: PushTarget, payload: PushPayload) => Promise<PushOutcome>>;

  const spySend = () => {
    send = vi.spyOn(app.get(PushSender), 'send').mockResolvedValue('sent');
  };

  beforeAll(async () => {
    ({ app, url } = await startApp(env));
  });

  afterAll(async () => {
    await sql('TRUNCATE pilots CASCADE');
    await app.close();
  });

  beforeEach(async () => {
    await sql('TRUNCATE pilots CASCADE');
    spySend();
  });

  /** A Pilote with a session: their id and the cookie of a tab. */
  const pilot = async (login = 'octocat'): Promise<{ id: string; cookie: string }> => {
    const id = newId();
    await sql(`INSERT INTO pilots (id, github_user_id, login, time_zone) VALUES ($1, $2, $3, 'Europe/Paris')`, [id, Math.floor(Math.random() * 1e9), login]);
    const prisma = app.get(PrismaService);
    const token = await runInPilotScope(id, () => app.get(WebSessions).open(prisma.scoped, id, undefined));
    return { id, cookie: `${SESSION_COOKIE}=${token}` };
  };

  const write = (method: 'POST' | 'DELETE' | 'PATCH', path: string, cookie: string | null, body?: unknown): Promise<Response> =>
    fetch(`${url}/api/${path}`, {
      method,
      headers: { ...(cookie ? { cookie } : {}), 'content-type': 'application/json', origin: appOrigin(env) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

  const subscribe = (cookie: string | null, body: unknown = browser()) => write('POST', 'push-subscriptions', cookie, body);
  const list = (cookie: string) => fetch(`${url}/api/push-subscriptions`, { headers: { cookie } });

  const events = (pilotId: string) =>
    sql<{ type: string; payload: Record<string, unknown> }>(`SELECT type, payload FROM events WHERE pilot_id = $1 AND type LIKE 'push-subscription.%' ORDER BY seq`, [
      pilotId,
    ]);

  /** Turns the account's « Notifications push » on, as the Paramètres' Toggle does. */
  const pushOn = async (cookie: string) => {
    const { seq } = (await (await fetch(`${url}/api/state`, { headers: { cookie } })).json()) as { seq: string };
    expect((await write('PATCH', 'settings', cookie, { seq, notifications: { push: true } })).status).toBe(200);
  };

  const raise = (pilotId: string, input: Partial<RaiseInput> = {}) =>
    runInPilotScope(pilotId, () => app.get(Transactions).run((tx) => app.get(DecisionsService).raise(tx, { ...BLOCKED, ...input })));

  const notifiedAt = async (id: string) => (await sql<{ notified_at: Date | null }>('SELECT notified_at FROM decisions WHERE id = $1', [id]))[0]?.notified_at ?? null;
  const claimedAt = async (id: string) => (await sql<{ push_claimed_at: Date | null }>('SELECT push_claimed_at FROM decisions WHERE id = $1', [id]))[0]?.push_claimed_at ?? null;

  /** `PUSH_CLAIM_MS` and more go by for the claims of the pushes. */
  const lapse = () => sql(`UPDATE decisions SET push_claimed_at = push_claimed_at - interval '3 minutes' WHERE push_claimed_at IS NOT NULL`);

  /** A Décision raised while a tab was visible, the tab closed since: it waits, and no push has taken it yet. */
  const raiseUnseen = async (pilotId: string) => {
    const presence = app.get(TabPresence);
    const tab = {};
    presence.open(pilotId, tab);
    presence.setVisibility(pilotId, tab, true);
    try {
      return (await raise(pilotId)).decision;
    } finally {
      presence.close(pilotId, tab);
    }
  };

  describe('POST /api/push-subscriptions', () => {
    it('subscribes the browser, returns the resource without its keys and writes push-subscription.upserted', async () => {
      const alice = await pilot();
      const input = browser();

      const res = await subscribe(alice.cookie, input);

      expect(res.status).toBe(201);
      const subscription = zPushSubscription.strict().parse(await res.json());
      expect(subscription).toMatchObject({ endpoint: input.endpoint, label: 'Safari · iPhone' });
      expect(await events(alice.id)).toEqual([{ type: 'push-subscription.upserted', payload: subscription }]);
      const [row] = await sql('SELECT pilot_id, p256dh, auth, last_pushed_at FROM push_subscriptions');
      expect(row).toEqual({ pilot_id: alice.id, p256dh: input.keys.p256dh, auth: input.keys.auth, last_pushed_at: null });
    });

    it('updates the keys and the label of an endpoint already subscribed, never a second row', async () => {
      const alice = await pilot();
      const input = browser();
      const first = zPushSubscription.parse(await (await subscribe(alice.cookie, input)).json());
      const renewed = { ...browser('Safari · iPad'), endpoint: input.endpoint };

      const res = await subscribe(alice.cookie, renewed);

      expect(res.status).toBe(201);
      expect(await res.json()).toEqual({ ...first, label: 'Safari · iPad' });
      expect(await sql('SELECT p256dh, auth FROM push_subscriptions')).toEqual([{ p256dh: renewed.keys.p256dh, auth: renewed.keys.auth }]);
    });

    it('refuses with 409 an endpoint another account receives on, and moves nothing', async () => {
      const alice = await pilot('alice');
      const bob = await pilot('bob');
      const input = browser();
      await subscribe(alice.cookie, input);

      await expectEnvelope(await subscribe(bob.cookie, input), 409, 'push-subscription.taken');
      expect(await sql('SELECT pilot_id FROM push_subscriptions')).toEqual([{ pilot_id: alice.id }]);
      expect(await events(bob.id)).toEqual([]);
    });

    it('refuses a 21st browser with 422', async () => {
      const alice = await pilot();
      for (let n = 0; n < 20; n += 1) expect((await subscribe(alice.cookie)).status).toBe(201);

      await expectEnvelope(await subscribe(alice.cookie), 422, 'push-subscription.too-many');
      expect(await sql('SELECT count(*)::int AS n FROM push_subscriptions')).toEqual([{ n: 20 }]);
    });

    it('answers 400 with the fields of a subscription that is not one', async () => {
      const alice = await pilot();
      await expectFields(await subscribe(alice.cookie, { endpoint: 'http://push.example.invalid/x', keys: { p256dh: 'short', auth: '' }, label: '' }), [
        'endpoint',
        'keys.p256dh',
        'keys.auth',
        'label',
      ]);
      await expectFields(await subscribe(alice.cookie, { ...browser(), label: 'x'.repeat(61) }), ['label']);
      await expectFields(await subscribe(alice.cookie, { ...browser(), endpoint: 'https://127.0.0.1:8443/internal' }), ['endpoint']);
      await expectFields(await subscribe(alice.cookie, { ...browser(), endpoint: 'https://fcm.googleapis.com.example.org/send/x' }), ['endpoint']);
      expect(await sql('SELECT * FROM push_subscriptions')).toEqual([]);
    });

    it('answers 401 without a session', async () => {
      await expectEnvelope(await subscribe(null), 401, 'auth.required');
    });
  });

  describe('GET /api/push-subscriptions', () => {
    it('lists the Pilote’s, newest first, and none of another Pilote’s; the state has them too', async () => {
      const alice = await pilot('alice');
      const bob = await pilot('bob');
      const older = zPushSubscription.parse(await (await subscribe(alice.cookie, browser('Safari · iPhone'))).json());
      const newer = zPushSubscription.parse(await (await subscribe(alice.cookie, browser('Chrome · Windows'))).json());
      await subscribe(bob.cookie);

      const res = await list(alice.cookie);

      expect(res.status).toBe(200);
      expect(zPushSubscriptionList.parse(await res.json())).toEqual({ items: [newer, older] });
      const state = zState.parse(await (await fetch(`${url}/api/state`, { headers: { cookie: alice.cookie } })).json());
      expect(state['push-subscriptions']).toEqual([newer, older]);
    });

    it('answers 401 without a session', async () => {
      await expectEnvelope(await fetch(`${url}/api/push-subscriptions`), 401, 'auth.required');
    });
  });

  describe('DELETE /api/push-subscriptions/:id', () => {
    it('removes the browser with 204 and writes push-subscription.removed', async () => {
      const alice = await pilot();
      const { id } = zPushSubscription.parse(await (await subscribe(alice.cookie)).json());

      const res = await write('DELETE', `push-subscriptions/${id}`, alice.cookie);

      expect(res.status).toBe(204);
      expect(await sql('SELECT * FROM push_subscriptions')).toEqual([]);
      expect((await events(alice.id)).map(({ type, payload }) => [type, payload])).toEqual([
        ['push-subscription.upserted', expect.objectContaining({ id })],
        ['push-subscription.removed', { id }],
      ]);
    });

    it('answers 404 for another Pilote’s, or an id that is not one, and removes nothing', async () => {
      const alice = await pilot('alice');
      const bob = await pilot('bob');
      const { id } = zPushSubscription.parse(await (await subscribe(alice.cookie)).json());

      await expectEnvelope(await write('DELETE', `push-subscriptions/${id}`, bob.cookie), 404, 'push-subscription.not-found');
      await expectEnvelope(await write('DELETE', 'push-subscriptions/nope', bob.cookie), 404, 'push-subscription.not-found');
      expect(await sql('SELECT id FROM push_subscriptions')).toEqual([{ id }]);
    });

    it('answers 401 without a session', async () => {
      await expectEnvelope(await write('DELETE', `push-subscriptions/${newId()}`, null), 401, 'auth.required');
    });
  });

  describe('the push of a Décision', () => {
    it('never requests a push service from a test: the sender of CREWDECK_ENV=test is inert', async () => {
      vi.restoreAllMocks();
      const target = { id: newId(), endpoint: browser().endpoint, p256dh: '', auth: '' };
      expect(app.get(PushSender)).toBeInstanceOf(InertPushSender);
      await expect(app.get(PushSender).send(target, { title: 'x', url: '/a-toi', tag: 'decisions' })).resolves.toBe('failed');
    });

    it('pushes a Décision raised while no tab is open at once to every browser, then marks it notified', async () => {
      const alice = await pilot();
      await pushOn(alice.cookie);
      const phone = browser('Safari · iPhone');
      const laptop = browser('Chrome · Windows');
      await subscribe(alice.cookie, phone);
      await subscribe(alice.cookie, laptop);

      const { decision } = await raise(alice.id);

      await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
      const payload = { title: 'Ticket bloqué · #42 Connexion GitHub', url: '/boucle?ticket=42', tag: decision.id };
      expect(send.mock.calls.map(([target, sent]) => [target.endpoint, target.p256dh, target.auth, sent]).sort()).toEqual(
        [
          [phone.endpoint, phone.keys.p256dh, phone.keys.auth, payload],
          [laptop.endpoint, laptop.keys.p256dh, laptop.keys.auth, payload],
        ].sort(),
      );
      await vi.waitFor(async () => expect(await sql('SELECT count(*)::int AS n FROM push_subscriptions WHERE last_pushed_at IS NOT NULL')).toEqual([{ n: 2 }]));
      expect(await notifiedAt(decision.id)).toBeInstanceOf(Date);
    });

    it('pushes nothing for a Décision its transaction rolled back', async () => {
      const alice = await pilot();
      await pushOn(alice.cookie);
      await subscribe(alice.cookie);

      const failing = runInPilotScope(alice.id, () =>
        app.get(Transactions).run(async (tx) => {
          await app.get(DecisionsService).raise(tx, BLOCKED);
          throw new Error('the module fails');
        }),
      );

      await expect(failing).rejects.toThrow('the module fails');
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(send).not.toHaveBeenCalled();
    });

    it('pushes nothing while a tab is visible', async () => {
      const alice = await pilot();
      await pushOn(alice.cookie);
      await subscribe(alice.cookie);
      const presence = app.get(TabPresence);
      const tab = {};
      presence.open(alice.id, tab);
      presence.setVisibility(alice.id, tab, true);
      try {
        const { decision } = await raise(alice.id);
        await new Promise((resolve) => setTimeout(resolve, 200));
        expect(send).not.toHaveBeenCalled();
        expect(await notifiedAt(decision.id)).toBeNull();
      } finally {
        presence.close(alice.id, tab);
      }
    });

    it('pushes the Décisions that waited as one « <n> Décisions t’attendent », those still open and never pushed only', async () => {
      const alice = await pilot();
      await pushOn(alice.cookie);
      await subscribe(alice.cookie);
      const presence = app.get(TabPresence);
      const tab = {};
      presence.open(alice.id, tab);
      presence.setVisibility(alice.id, tab, true);
      try {
        await raise(alice.id);
        await raise(alice.id, { subjectId: '43', label: '#43 Liste des Projets' });
        await raise(alice.id, { subjectId: '44', label: '#44 Revue' });
        await runInPilotScope(alice.id, () => app.get(Transactions).run((tx) => app.get(DecisionsService).resolve(tx, 'ticket-blocked', '44', 'answered')));
      } finally {
        presence.close(alice.id, tab);
      }

      await expect(app.get(PushDelivery).push(alice.id)).resolves.toBe('done');

      expect(send.mock.calls.map(([, payload]) => payload)).toEqual([{ title: '2 Décisions t’attendent', url: '/a-toi', tag: 'decisions' }]);
      await app.get(PushDelivery).push(alice.id);
      expect(send).toHaveBeenCalledTimes(1);
    });

    it('reads what waits from the database: a restart loses none of it', async () => {
      const alice = await pilot();
      await pushOn(alice.cookie);
      await subscribe(alice.cookie);
      const tab = {};
      const presence = app.get(TabPresence);
      presence.open(alice.id, tab);
      presence.setVisibility(alice.id, tab, true);
      const { decision } = await raise(alice.id);
      presence.close(alice.id, tab);
      await app.close();
      ({ app, url } = await startApp(env));
      spySend();

      await expect(app.get(PushDelivery).push(alice.id)).resolves.toBe('done');

      expect(send.mock.calls.map(([, payload]) => payload.tag)).toEqual([decision.id]);
      expect(await notifiedAt(decision.id)).toBeInstanceOf(Date);
    });

    it('never pushes what waited once a tab is visible again, and still what is raised after', async () => {
      const alice = await pilot();
      await pushOn(alice.cookie);
      await subscribe(alice.cookie);
      const presence = app.get(TabPresence);
      const tab = {};
      presence.open(alice.id, tab);
      presence.setVisibility(alice.id, tab, true);
      try {
        const seen = await raise(alice.id);
        presence.setVisibility(alice.id, tab, false);
        presence.setVisibility(alice.id, tab, true);
        await vi.waitFor(async () => expect(await notifiedAt(seen.decision.id)).toBeInstanceOf(Date));
        const later = await raise(alice.id, { subjectId: '43', label: '#43 Liste des Projets' });

        await app.get(PushDelivery).push(alice.id);

        expect(send.mock.calls.map(([, payload]) => payload.tag)).toEqual([later.decision.id]);
      } finally {
        presence.close(alice.id, tab);
      }
    });

    it('keeps waiting a Décision no browser got, its push service failing, and pushes it on the next try', async () => {
      const alice = await pilot();
      await pushOn(alice.cookie);
      await subscribe(alice.cookie);
      const presence = app.get(TabPresence);
      const tab = {};
      presence.open(alice.id, tab);
      presence.setVisibility(alice.id, tab, true);
      const { decision } = await raise(alice.id);
      presence.close(alice.id, tab);
      send.mockResolvedValueOnce('failed');

      await expect(app.get(PushDelivery).push(alice.id)).resolves.toBe('retry');
      expect(await notifiedAt(decision.id)).toBeNull();
      expect(await sql('SELECT last_pushed_at FROM push_subscriptions')).toEqual([{ last_pushed_at: null }]);

      await expect(app.get(PushDelivery).push(alice.id)).resolves.toBe('done');
      expect(send).toHaveBeenCalledTimes(2);
      expect(await notifiedAt(decision.id)).toBeInstanceOf(Date);
    });

    it('pushes again, once its claim lapses, a Décision a push took before the server stopped', async () => {
      const alice = await pilot();
      await pushOn(alice.cookie);
      await subscribe(alice.cookie);
      const decision = await raiseUnseen(alice.id);
      send.mockReturnValueOnce(new Promise<PushOutcome>(() => undefined));
      void app.get(PushDelivery).push(alice.id);
      await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
      await app.close();
      ({ app, url } = await startApp(env));
      spySend();

      await expect(app.get(PushDelivery).push(alice.id)).resolves.toBe('retry');
      expect(send).not.toHaveBeenCalled();
      await lapse();
      await expect(app.get(PushDelivery).push(alice.id)).resolves.toBe('done');

      expect(send.mock.calls.map(([, payload]) => payload.tag)).toEqual([decision.id]);
      expect(await notifiedAt(decision.id)).toBeInstanceOf(Date);
      expect(await claimedAt(decision.id)).toBeNull();
    });

    it('pushes again, once its claim lapses, a Décision whose hand back failed', async () => {
      const alice = await pilot();
      await pushOn(alice.cookie);
      await subscribe(alice.cookie);
      const decision = await raiseUnseen(alice.id);
      send.mockResolvedValueOnce('failed');
      vi.spyOn(app.get(PushSubscriptions), 'pushed').mockRejectedValueOnce(new Error('the database is gone'));

      await expect(app.get(PushDelivery).push(alice.id)).resolves.toBe('retry');
      await expect(app.get(PushDelivery).push(alice.id)).resolves.toBe('retry');
      expect(send).toHaveBeenCalledTimes(1);
      await lapse();
      await expect(app.get(PushDelivery).push(alice.id)).resolves.toBe('done');

      expect(send.mock.calls.map(([, payload]) => payload.tag)).toEqual([decision.id, decision.id]);
      expect(await notifiedAt(decision.id)).toBeInstanceOf(Date);
    });

    it('never pushes again a Décision seen while a push held it, that push failing', async () => {
      const alice = await pilot();
      await pushOn(alice.cookie);
      await subscribe(alice.cookie);
      const decision = await raiseUnseen(alice.id);
      let fail: (outcome: PushOutcome) => void = () => undefined;
      send.mockReturnValueOnce(
        new Promise<PushOutcome>((resolve) => {
          fail = resolve;
        }),
      );
      const pushing = app.get(PushDelivery).push(alice.id);
      await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
      const presence = app.get(TabPresence);
      const tab = {};
      presence.open(alice.id, tab);
      presence.setVisibility(alice.id, tab, true);
      await vi.waitFor(async () => expect(await notifiedAt(decision.id)).toBeInstanceOf(Date));
      presence.close(alice.id, tab);

      fail('failed');

      await expect(pushing).resolves.toBe('done');
      await expect(app.get(PushDelivery).push(alice.id)).resolves.toBe('done');
      expect(send).toHaveBeenCalledTimes(1);
      expect(await notifiedAt(decision.id)).toBeInstanceOf(Date);
      expect(await claimedAt(decision.id)).toBeNull();
    });

    it('sends nothing when the account has push off, and never later what was raised then', async () => {
      const alice = await pilot();
      await subscribe(alice.cookie);

      const { decision } = await raise(alice.id);
      await app.get(PushDelivery).push(alice.id);
      await pushOn(alice.cookie);
      await app.get(PushDelivery).push(alice.id);

      expect(send).not.toHaveBeenCalled();
      expect(await notifiedAt(decision.id)).toBeInstanceOf(Date);
    });

    it('sends nothing for a Décision whose Projet has push off, the others still', async () => {
      const alice = await pilot();
      await pushOn(alice.cookie);
      await subscribe(alice.cookie);
      const settings = app.get(SettingsService);
      const effective = settings.effective.bind(settings);
      vi.spyOn(settings, 'effective').mockImplementation(async (pilotId, projectId) => {
        const value = await effective(pilotId, projectId);
        return projectId === PROJECT ? { ...value, notifications: { push: false } } : value;
      });
      const presence = app.get(TabPresence);
      const tab = {};
      presence.open(alice.id, tab);
      presence.setVisibility(alice.id, tab, true);
      try {
        await raise(alice.id);
        await raise(alice.id, { projectId: null, projectName: null, subjectType: 'runner', subjectId: newId(), kind: 'runner-offline', label: 'Le travail attend', link: '/runner' });
      } finally {
        presence.close(alice.id, tab);
      }

      await app.get(PushDelivery).push(alice.id);
      await app.get(PushDelivery).push(alice.id);

      expect(send.mock.calls.map(([, payload]) => payload.title)).toEqual(['Runner hors ligne · Le travail attend']);
    });

    it('removes a browser its push service says is gone (410), with its event, and keeps the others', async () => {
      const alice = await pilot();
      await pushOn(alice.cookie);
      const gone = zPushSubscription.parse(await (await subscribe(alice.cookie, browser('Firefox · Linux'))).json());
      const kept = zPushSubscription.parse(await (await subscribe(alice.cookie, browser('Safari · iPhone'))).json());
      send.mockImplementation((target) => Promise.resolve(target.id === gone.id ? 'gone' : 'sent'));

      await raise(alice.id);

      await vi.waitFor(async () => expect(await sql('SELECT id FROM push_subscriptions')).toEqual([{ id: kept.id }]));
      expect((await events(alice.id)).at(-1)).toEqual({ type: 'push-subscription.removed', payload: { id: gone.id } });
    });

    it('pushes nothing to a Pilote with no browser, and leaves the Décision to a later push', async () => {
      const alice = await pilot();
      await pushOn(alice.cookie);

      const { decision } = await raise(alice.id);
      await app.get(PushDelivery).push(alice.id);

      expect(send).not.toHaveBeenCalled();
      expect(await notifiedAt(decision.id)).toBeNull();
    });

    it('never fails the raise when the push fails', async () => {
      const alice = await pilot();
      await pushOn(alice.cookie);
      await subscribe(alice.cookie);
      send.mockRejectedValue(new Error('the push service is down'));

      await expect(raise(alice.id)).resolves.toMatchObject({ created: true });
      await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    });
  });
});
