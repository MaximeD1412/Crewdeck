import type { INestApplication } from '@nestjs/common';
import pg from 'pg';
import { inject } from 'vitest';
import { zMe, zState } from '@crewdeck/contracts';
import { SESSION_COOKIE } from '../../src/auth/cookies.js';
import { WebSessions } from '../../src/auth/web-sessions.js';
import { parseEnv } from '../../src/config/env.js';
import { WebhookDispatcher } from '../../src/github/webhooks/dispatcher.js';
import { newId } from '../../src/ids.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { runInPilotScope } from '../../src/scope/scope.context.js';
import { FAKES, type Fakes } from '../../src/testing/fakes.js';
import { deliverWebhook, TEST_WEBHOOK_SECRET, webhookFixture } from '../fakes/github.js';
import { authKeysEnv } from '../github-app.js';
import { expectEnvelope, startApp } from '../route-baseline.js';

const databaseUrl = inject('databaseUrl');
const APP_URL = 'https://crewdeck.example';
/** The GitHub user of the webhook fixtures: they installed the App before being a Pilote. */
const SENDER = { id: 9100001, login: 'octo-fixture', avatarUrl: 'https://avatars.example/u/9100001' };
const HUBOT = { id: 9100002, login: 'hubot', avatarUrl: 'https://avatars.example/u/9100002' };
const INSTALLATION_ID = 51000001;

const sql = async <T extends pg.QueryResultRow>(text: string, values: unknown[] = []): Promise<T[]> => {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    return (await client.query<T>(text, values)).rows;
  } finally {
    await client.end();
  }
};

/** The `name=value` of the cookie `name` a response sets. */
const cookieOf = (res: Response, name: string): string | undefined =>
  res.headers.getSetCookie().find((line) => line.startsWith(`${name}=`))?.split(';')[0];

interface Tab {
  readonly id: string;
  readonly cookie: string;
}

/**
 * « Relier GitHub » (CORE-11, ADR 0014): a Pilote signed in another way
 * links their GitHub account through the App's user authorization, on the
 * one callback of the sign-in.
 */
describe('« Relier GitHub » against PostgreSQL', () => {
  let app: INestApplication;
  let url: string;
  let fakes: Fakes;

  beforeAll(async () => {
    const env = parseEnv({
      CREWDECK_ENV: 'test',
      DATABASE_URL: databaseUrl,
      CREWDECK_FAKES: '1',
      PUBLIC_URL: APP_URL,
      GITHUB_WEBHOOK_SECRET: TEST_WEBHOOK_SECRET,
      ...authKeysEnv(),
    });
    ({ app, url } = await startApp(env));
    fakes = app.get<Fakes>(FAKES);
  });

  const empty = () => sql('TRUNCATE pilots, github_installations, github_deliveries CASCADE');

  afterAll(async () => {
    await empty();
    await app.close();
  });

  beforeEach(async () => {
    await empty();
    fakes.github.reset();
    fakes.github.seedUser(SENDER);
    fakes.github.seedUser(HUBOT, { code: 'hubot-code' });
  });

  /** A Pilote signed up by email, with an open session: no GitHub. */
  const emailPilot = async (email = 'pilote@example.com'): Promise<Tab> => {
    const id = newId();
    await sql(`INSERT INTO pilots (id, display_name, time_zone) VALUES ($1, $2, 'Europe/Paris')`, [id, email.split('@')[0]]);
    await sql(`INSERT INTO pilot_identities (id, pilot_id, provider, subject, email) VALUES ($1, $2, 'email', $3, $3)`, [newId(), id, email]);
    return { id, cookie: await sessionOf(id) };
  };

  const sessionOf = async (pilotId: string): Promise<string> => {
    const prisma = app.get(PrismaService);
    const token = await runInPilotScope(pilotId, () => app.get(WebSessions).open(prisma.scoped, pilotId, undefined));
    return `${SESSION_COOKIE}=${token}`;
  };

  const githubIdentity = (pilotId: string, user: { id: number; login: string }) =>
    sql(`INSERT INTO pilot_identities (id, pilot_id, provider, subject, login) VALUES ($1, $2, 'github', $3, $4)`, [newId(), pilotId, String(user.id), user.login]);

  /** `GET /api/auth/github/link` with `tab`'s cookie: GitHub's authorize page, and the oauth cookie. */
  const startLink = async (tab: Tab, next?: string): Promise<{ res: Response; state: string; oauth: string }> => {
    const query = next === undefined ? '' : `?${new URLSearchParams({ next })}`;
    const res = await fetch(`${url}/api/auth/github/link${query}`, { redirect: 'manual', headers: { cookie: tab.cookie } });
    const state = new URL(res.headers.get('location') ?? '', url).searchParams.get('state') ?? '';
    return { res, state, oauth: cookieOf(res, 'crewdeck_oauth') ?? '' };
  };

  /** The link of `tab`, GitHub coming back with `code` (or `error`) to the callback, the browser's cookies `cookie`. */
  const link = async (
    tab: Tab,
    { code = 'fake-code', error, next, cookie, state: given }: { code?: string; error?: string; next?: string; cookie?: string; state?: string } = {},
  ): Promise<Response> => {
    const started = await startLink(tab, next);
    const state = given ?? started.state;
    const { oauth } = started;
    const query: Record<string, string> = error === undefined ? { code, state } : { error, state };
    return fetch(`${url}/api/auth/github/callback?${new URLSearchParams(query)}`, {
      redirect: 'manual',
      headers: { cookie: [oauth, cookie ?? tab.cookie].filter(Boolean).join('; ') },
    });
  };

  const call = (tab: Tab, path: string, init: RequestInit = {}): Promise<Response> =>
    fetch(`${url}${path}`, { ...init, headers: { origin: APP_URL, cookie: tab.cookie, ...init.headers } });

  const me = async (tab: Tab) => zMe.parse(await (await call(tab, '/api/me')).json());

  it('links GitHub to a Pilote signed in by email: the Identité, the tokens, pilot.upserted, back to /parametres', async () => {
    const pilote = await emailPilot();

    const started = await startLink(pilote);
    expect(started.res.status).toBe(302);
    expect(started.res.headers.get('location')).toMatch(/^\/fake-github\/login\/oauth\/authorize\?/);
    expect(started.state).not.toBe('');
    const res = await link(pilote);

    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/parametres');
    expect(cookieOf(res, 'crewdeck_session')).toBeUndefined();
    expect(await me(pilote)).toMatchObject({
      identities: [
        { provider: 'email', label: 'pilote@example.com', reconnect: false },
        { provider: 'github', label: 'octo-fixture', reconnect: false },
      ],
      githubLinked: true,
    });
    expect(await sql('SELECT pilot_id FROM github_user_tokens')).toEqual([{ pilot_id: pilote.id }]);
    const events = await sql<{ payload: { githubLinked: boolean } }>(`SELECT payload FROM events WHERE pilot_id = $1 AND type = 'pilot.upserted'`, [pilote.id]);
    expect(events.map((event) => event.payload.githubLinked)).toEqual([true]);
    expect((await call(pilote, '/api/github/token', { method: 'POST' })).status).toBe(200);
  });

  it('makes an installation that GitHub user made before theirs, and reconciles its repositories at once', async () => {
    fakes.github.seedRepo({ owner: 'octo-fixture', name: 'fixture-app', id: 71000001, installationId: INSTALLATION_ID });
    const delivered = await deliverWebhook(url, { event: 'installation', payload: webhookFixture('installation.created') });
    expect(delivered.status).toBe(202);
    await app.get(WebhookDispatcher).settled();
    expect(await sql('SELECT pilot_id FROM github_installations')).toEqual([{ pilot_id: null }]);
    const pilote = await emailPilot();

    await link(pilote);

    expect(await sql('SELECT pilot_id FROM github_installations')).toEqual([{ pilot_id: pilote.id }]);
    await expect
      .poll(async () => zState.parse(await (await call(pilote, '/api/state')).json()).repositories.map((repository) => repository.fullName), { timeout: 5_000 })
      .toEqual(['octo-fixture/fixture-app']);
  });

  it('comes back to next, a path of the site, /parametres otherwise', async () => {
    const pilote = await emailPilot();
    expect((await link(pilote, { next: '/demarrage' })).headers.get('location')).toBe('/demarrage');

    const other = await emailPilot('autre@example.com');
    expect((await link(other, { next: '//evil.example', code: 'hubot-code' })).headers.get('location')).toBe('/parametres');
  });

  it('stores the tokens again for the Pilote’s own GitHub account: a reconnection', async () => {
    const pilote = await emailPilot();
    await githubIdentity(pilote.id, SENDER);
    expect(await me(pilote)).toMatchObject({ githubLinked: false, identities: [{ reconnect: false }, { provider: 'github', reconnect: true }] });

    const res = await link(pilote);

    expect(res.headers.get('location')).toBe('/parametres');
    expect(await me(pilote)).toMatchObject({ githubLinked: true, identities: [{ reconnect: false }, { provider: 'github', reconnect: false }] });
    expect(await sql(`SELECT count(*)::int AS n FROM pilot_identities WHERE provider = 'github'`)).toEqual([{ n: 1 }]);
  });

  it('refuses a GitHub account that is another Pilote’s: both unchanged, ?erreur=github-already-linked', async () => {
    const owner = await emailPilot('owner@example.com');
    await githubIdentity(owner.id, SENDER);
    const pilote = await emailPilot();

    const res = await link(pilote, { next: '/demarrage' });

    expect(res.headers.get('location')).toBe('/demarrage?erreur=github-already-linked');
    expect(await sql('SELECT pilot_id, provider FROM pilot_identities ORDER BY created_at, provider')).toEqual([
      { pilot_id: owner.id, provider: 'email' },
      { pilot_id: owner.id, provider: 'github' },
      { pilot_id: pilote.id, provider: 'email' },
    ]);
    expect(await sql('SELECT pilot_id FROM github_user_tokens')).toEqual([]);
    expect(await sql(`SELECT seq FROM events WHERE type = 'pilot.upserted'`)).toEqual([]);
  });

  it('refuses a second GitHub account: ?erreur=github-other-account, nothing stored', async () => {
    const pilote = await emailPilot();
    await githubIdentity(pilote.id, HUBOT);

    const res = await link(pilote);

    expect(res.headers.get('location')).toBe('/parametres?erreur=github-other-account');
    expect(await sql(`SELECT subject FROM pilot_identities WHERE provider = 'github'`)).toEqual([{ subject: String(HUBOT.id) }]);
    expect(await sql('SELECT pilot_id FROM github_user_tokens')).toEqual([]);
  });

  it.each([
    ['another session’s cookie', 'other', undefined],
    ['no session cookie', 'none', undefined],
    ['another state', 'own', undefined],
    ['GitHub’s error and another session’s cookie', 'other', 'access_denied'],
    ['GitHub’s error and no session cookie', 'none', 'access_denied'],
    ['GitHub’s error and another state', 'own', 'access_denied'],
  ])('is state-mismatch with %s, and links nothing', async (_, which, error) => {
    const pilote = await emailPilot();
    const other = await emailPilot('autre@example.com');
    const cookie = { other: other.cookie, none: '', own: undefined }[which];

    const res = await link(pilote, { cookie, error, ...(which === 'own' ? { state: 'not-the-state' } : {}) });

    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/connexion?erreur=state-mismatch');
    expect(await sql(`SELECT id FROM pilot_identities WHERE provider = 'github'`)).toEqual([]);
    expect(await sql('SELECT pilot_id FROM github_user_tokens')).toEqual([]);
    expect(cookieOf(res, 'crewdeck_session')).toBeUndefined();
  });

  it.each([
    ['a refusal of the Pilote', 'denied', { error: 'access_denied' }],
    ['another error of GitHub', 'github-unavailable', { error: 'application_suspended' }],
    ['a code GitHub refuses', 'github-unavailable', { code: 'stale' }],
  ])('sends %s back to next?erreur=%s, linked to nothing', async (_, error, change: { error?: string; code?: string }) => {
    const pilote = await emailPilot();

    const res = await link(pilote, change);

    expect(res.headers.get('location')).toBe(`/parametres?erreur=${error}`);
    expect(await sql(`SELECT id FROM pilot_identities WHERE provider = 'github'`)).toEqual([]);
    expect((await call(pilote, '/api/me')).status).toBe(200);
  });

  it('links nothing when the installations cannot become the Pilote’s: the Identité, the tokens and pilot.upserted roll back with them', async () => {
    const delivered = await deliverWebhook(url, { event: 'installation', payload: webhookFixture('installation.created') });
    expect(delivered.status).toBe(202);
    await app.get(WebhookDispatcher).settled();
    const pilote = await emailPilot();
    await sql(`CREATE FUNCTION test_refuse_attach() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'attach refused'; END $$`);
    await sql(`CREATE TRIGGER test_refuse_attach BEFORE UPDATE OF pilot_id ON github_installations FOR EACH ROW EXECUTE FUNCTION test_refuse_attach()`);
    try {
      const res = await link(pilote);
      expect(res.status).toBe(500);
    } finally {
      await sql('DROP TRIGGER test_refuse_attach ON github_installations');
      await sql('DROP FUNCTION test_refuse_attach()');
    }

    expect(await sql(`SELECT id FROM pilot_identities WHERE provider = 'github'`)).toEqual([]);
    expect(await sql('SELECT pilot_id FROM github_user_tokens')).toEqual([]);
    expect(await sql(`SELECT seq FROM events WHERE type = 'pilot.upserted'`)).toEqual([]);
    expect(await sql('SELECT pilot_id FROM github_installations')).toEqual([{ pilot_id: null }]);
    expect(await me(pilote)).toMatchObject({ githubLinked: false });
  });

  it('answers 401 auth.required to a link without a session', async () => {
    await expectEnvelope(await fetch(`${url}/api/auth/github/link`, { redirect: 'manual' }), 401, 'auth.required');
  });
});
