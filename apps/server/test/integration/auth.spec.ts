import type { INestApplication } from '@nestjs/common';
import pg from 'pg';
import { inject } from 'vitest';
import { WS_CLOSE, zGithubToken, zMe } from '@crewdeck/contracts';
import { parseEnv } from '../../src/config/env.js';
import { userTokenRefused } from '../../src/github/github.errors.js';
import { newId } from '../../src/ids.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { runInPilotScope } from '../../src/scope/scope.context.js';
import { FAKES, type Fakes } from '../../src/testing/fakes.js';
import { connect, type WsClient } from '../fakes/ws-client.js';
import { authKeysEnv } from '../github-app.js';
import { expectEnvelope, startApp } from '../route-baseline.js';

const databaseUrl = inject('databaseUrl');
const APP_URL = 'https://crewdeck.example';
const OCTOCAT = { id: 583231, login: 'octocat', avatarUrl: 'https://avatars.example/u/583231' };

const sql = async <T extends pg.QueryResultRow>(text: string, values: unknown[] = []): Promise<T[]> => {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    return (await client.query<T>(text, values)).rows;
  } finally {
    await client.end();
  }
};

/** The `name=value` of each cookie a response sets. */
const setCookies = (res: Response): Map<string, string> =>
  new Map(res.headers.getSetCookie().map((line) => {
    const [pair = ''] = line.split(';');
    const at = pair.indexOf('=');
    return [pair.slice(0, at), line];
  }));

const cookieValue = (line: string | undefined): string => line?.split(';')[0]?.split('=').slice(1).join('=') ?? '';

describe('sign in with GitHub against PostgreSQL', () => {
  let app: INestApplication;
  let url: string;
  let fakes: Fakes;

  beforeAll(async () => {
    const env = parseEnv({ CREWDECK_ENV: 'test', DATABASE_URL: databaseUrl, CREWDECK_FAKES: '1', PUBLIC_URL: APP_URL, ...authKeysEnv() });
    ({ app, url } = await startApp(env));
    fakes = app.get<Fakes>(FAKES);
  });

  afterAll(async () => {
    // The files share the run's database: none leaves its Pilotes to the next.
    await sql('TRUNCATE pilots CASCADE');
    await app.close();
  });

  beforeEach(async () => {
    await sql('TRUNCATE pilots CASCADE');
    fakes.github.reset();
    fakes.github.seedUser(OCTOCAT);
  });

  /** `start`, then the callback GitHub would call with `code`, the oauth cookie sent back. */
  const signIn = async ({ timeZone = 'Europe/Paris', next = '/idees', code = 'fake-code' } = {}): Promise<Response> => {
    const start = await fetch(`${url}/api/auth/github/start?${new URLSearchParams({ timeZone, next })}`, { redirect: 'manual' });
    const authorize = new URL(start.headers.get('location') ?? '', url);
    const state = authorize.searchParams.get('state') ?? '';
    const oauth = setCookies(start).get('crewdeck_oauth');
    return fetch(`${url}/api/auth/github/callback?${new URLSearchParams({ code, state })}`, {
      redirect: 'manual',
      headers: { cookie: `crewdeck_oauth=${cookieValue(oauth)}` },
    });
  };

  it('creates the Pilot with the time zone, stores both tokens encrypted, sets the cookie and redirects to next', async () => {
    const res = await signIn();

    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/idees');
    const session = setCookies(res).get('crewdeck_session');
    expect(session).toMatch(/^crewdeck_session=[\w-]{43}; /);
    expect(session).toMatch(/HttpOnly/i);
    expect(session).toMatch(/SameSite=Lax/i);
    expect(session).toMatch(/Path=\//);
    expect(session).toMatch(/Max-Age=2592000/);
    const pilots = await sql<{ id: string; login: string; time_zone: string; avatar_url: string }>('SELECT * FROM pilots');
    expect(pilots).toEqual([expect.objectContaining({ login: 'octocat', time_zone: 'Europe/Paris', avatar_url: OCTOCAT.avatarUrl })]);
    const [tokens] = await sql<{ pilot_id: string; access_token_enc: Buffer; refresh_token_enc: Buffer; key_version: number }>(
      'SELECT * FROM github_user_tokens',
    );
    expect(tokens).toMatchObject({ pilot_id: pilots[0]?.id, key_version: 1 });
    expect(tokens?.access_token_enc.includes('ghu_fake')).toBe(false);
    expect(tokens?.refresh_token_enc.includes('ghr_fake')).toBe(false);
    expect(await sql('SELECT pilot_id FROM web_sessions')).toEqual([{ pilot_id: pilots[0]?.id }]);
  });

  /** The `crewdeck_session=<token>` a signed-in browser sends. */
  const signedIn = async (options?: Parameters<typeof signIn>[0]): Promise<string> =>
    (setCookies(await signIn(options)).get('crewdeck_session') ?? '').split(';')[0] ?? '';

  const sockets: WsClient[] = [];
  afterEach(async () => {
    await Promise.all(sockets.splice(0).map((client) => client.close()));
  });

  /** A socket of the page on `/api/ws`, answered once open (a pong), with its cookie. */
  const socket = async (cookie: string): Promise<WsClient> => {
    const client = await connect(url, { cookie, origin: APP_URL });
    sockets.push(client);
    client.send({ type: 'ping' });
    await client.next('pong');
    return client;
  };

  /** A call of the page: its Origin, its cookie. */
  const call = (path: string, cookie: string, init: RequestInit = {}): Promise<Response> =>
    fetch(`${url}${path}`, { ...init, headers: { origin: APP_URL, cookie, ...init.headers } });

  it('updates the login of a second sign-in, and keeps the first time zone', async () => {
    await signIn({ timeZone: 'Europe/Paris' });
    fakes.github.seedUser({ ...OCTOCAT, login: 'octocat-renamed' });

    await signIn({ timeZone: 'America/New_York' });

    expect(await sql('SELECT login, time_zone FROM pilots')).toEqual([{ login: 'octocat-renamed', time_zone: 'Europe/Paris' }]);
    expect(await sql('SELECT count(*)::int AS n FROM web_sessions')).toEqual([{ n: 2 }]);
  });

  it('takes UTC for a time zone the server does not know, and /a-toi for a next outside the site', async () => {
    const res = await signIn({ timeZone: 'Mars/Olympus', next: '//evil.example/a-toi' });

    expect(res.headers.get('location')).toBe('/a-toi');
    expect(await sql('SELECT time_zone FROM pilots')).toEqual([{ time_zone: 'UTC' }]);
  });

  it.each([
    ['a wrong state', { state: 'forged' }, 'state-mismatch'],
    ['no oauth cookie', { cookie: '' }, 'state-mismatch'],
    ['a refusal of the Pilote', { error: 'access_denied' }, 'denied'],
    ['another error of GitHub', { error: 'application_suspended' }, 'github-unavailable'],
    ['a code GitHub refuses', { code: 'stale' }, 'github-unavailable'],
  ])('sends %s back to /connexion?erreur=%s, signed out', async (_, change: { state?: string; cookie?: string; error?: string; code?: string }, error) => {
    const start = await fetch(`${url}/api/auth/github/start?timeZone=UTC`, { redirect: 'manual' });
    const state = new URL(start.headers.get('location') ?? '', url).searchParams.get('state') ?? '';
    const cookie = change.cookie ?? `crewdeck_oauth=${cookieValue(setCookies(start).get('crewdeck_oauth'))}`;
    const query: Record<string, string> = change.error ? { error: change.error, state } : { code: change.code ?? 'fake-code', state: change.state ?? state };

    const res = await fetch(`${url}/api/auth/github/callback?${new URLSearchParams(query)}`, { redirect: 'manual', headers: { cookie } });

    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(`/connexion?erreur=${error}`);
    expect(setCookies(res).has('crewdeck_session')).toBe(false);
    expect(setCookies(res).get('crewdeck_oauth')).toMatch(/Max-Age=0/);
    expect(await sql('SELECT * FROM pilots')).toEqual([]);
  });

  describe('POST /api/github/token', () => {
    it('returns the access token while more than 5 minutes remain', async () => {
      const cookie = await signedIn();

      const res = await call('/api/github/token', cookie, { method: 'POST' });

      expect(res.status).toBe(200);
      expect(zGithubToken.parse(await res.json())).toMatchObject({ accessToken: 'ghu_fake_1' });
      expect(fakes.github.calls.map((c) => c.method)).not.toContain('refreshUserToken');
    });

    it('refreshes it when it expires within 5 minutes, and stores the new tokens', async () => {
      const cookie = await signedIn();
      await sql(`UPDATE github_user_tokens SET access_expires_at = now() + interval '4 minutes'`);

      const res = await call('/api/github/token', cookie, { method: 'POST' });
      const again = await call('/api/github/token', cookie, { method: 'POST' });

      const token = zGithubToken.parse(await res.json());
      expect(token.accessToken).toBe('ghu_fake_2');
      expect(Date.parse(token.expiresAt) - Date.now()).toBeGreaterThan(7 * 60 * 60 * 1000);
      expect(zGithubToken.parse(await again.json()).accessToken).toBe('ghu_fake_2');
    });

    it('refreshes once for concurrent calls: GitHub refresh tokens are single-use', async () => {
      const cookie = await signedIn();
      await sql(`UPDATE github_user_tokens SET access_expires_at = now() + interval '1 minute'`);
      // GitHub takes its time: the three calls are all in flight during the refresh.
      const refresh = fakes.github.refreshUserToken.bind(fakes.github);
      vi.spyOn(fakes.github, 'refreshUserToken').mockImplementation(async (token) => {
        await new Promise((resolve) => setTimeout(resolve, 200));
        return refresh(token);
      });

      const responses = await Promise.all([1, 2, 3].map(() => call('/api/github/token', cookie, { method: 'POST' })));

      expect(responses.map((res) => res.status)).toEqual([200, 200, 200]);
      expect(fakes.github.refreshUserToken).toHaveBeenCalledTimes(1);
    });

    it('signs the Pilote out with 401 auth.github-expired when GitHub refuses the refresh, and closes all their sockets', async () => {
      const cookie = await signedIn();
      const other = await signedIn();
      const sockets = [await socket(cookie), await socket(other)];
      await sql(`UPDATE github_user_tokens SET access_expires_at = now() + interval '1 minute'`);
      fakes.github.reset();
      fakes.github.seedUser(OCTOCAT);

      const res = await call('/api/github/token', cookie, { method: 'POST' });

      await expectEnvelope(res, 401, 'auth.github-expired');
      expect(await sql('SELECT * FROM web_sessions')).toEqual([]);
      await expectEnvelope(await call('/api/me', cookie), 401, 'auth.required');
      for (const client of sockets) expect((await client.closed()).code).toBe(WS_CLOSE.unauthorized);
    });

    it('keeps a sign-in that completes while an earlier refresh is pending, then refused', async () => {
      const cookie = await signedIn();
      await sql(`UPDATE github_user_tokens SET access_expires_at = now() + interval '1 minute'`);
      // GitHub answers the refresh late, and refuses it: the Pilote signed in again meanwhile.
      let refuse = (): void => undefined;
      vi.spyOn(fakes.github, 'refreshUserToken').mockImplementation(
        () => new Promise((_resolve, reject) => { refuse = () => reject(userTokenRefused()); }),
      );
      const pending = call('/api/github/token', cookie, { method: 'POST' });
      await vi.waitFor(() => expect(fakes.github.refreshUserToken).toHaveBeenCalled());
      const again = await signedIn();

      refuse();
      const res = await pending;

      expect(res.status).toBe(200);
      expect(zGithubToken.parse(await res.json()).accessToken).toBe('ghu_fake_2');
      expect((await call('/api/me', again)).status).toBe(200);
      expect(await sql('SELECT pilot_id FROM github_user_tokens')).toHaveLength(1);
      expect(await sql('SELECT id FROM web_sessions')).toHaveLength(2);
    });

    it('signs the Pilote out when the refresh token has expired', async () => {
      const cookie = await signedIn();
      await sql(`UPDATE github_user_tokens SET access_expires_at = now(), refresh_expires_at = now()`);

      await expectEnvelope(await call('/api/github/token', cookie, { method: 'POST' }), 401, 'auth.github-expired');
      expect(await sql('SELECT * FROM web_sessions')).toEqual([]);
    });
  });

  describe('GET /api/me', () => {
    it('is the signed-in Pilote', async () => {
      const cookie = await signedIn();

      const res = await call('/api/me', cookie);

      expect(res.status).toBe(200);
      expect(zMe.parse(await res.json())).toEqual({ id: expect.any(String), login: 'octocat', avatarUrl: OCTOCAT.avatarUrl, timeZone: 'Europe/Paris' });
    });

    it('answers 401 auth.required without a cookie, or with a session id forged', async () => {
      await signedIn();
      const [session] = await sql<{ id: string }>('SELECT id FROM web_sessions');

      await expectEnvelope(await fetch(`${url}/api/me`), 401, 'auth.required');
      await expectEnvelope(await call('/api/me', `crewdeck_session=${session?.id}`), 401, 'auth.required');
      await expectEnvelope(await call('/api/me', 'crewdeck_session=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'), 401, 'auth.required');
    });

    it('answers 401 auth.required once the session has expired', async () => {
      const cookie = await signedIn();
      await sql(`UPDATE web_sessions SET expires_at = now() - interval '1 second'`);

      await expectEnvelope(await call('/api/me', cookie), 401, 'auth.required');
    });

    it('slides the session 30 days from a use more than an hour after the last', async () => {
      const cookie = await signedIn();
      await sql(`UPDATE web_sessions SET last_seen_at = now() - interval '2 hours', expires_at = now() + interval '1 day'`);

      const res = await call('/api/me', cookie);
      const again = await call('/api/me', cookie);

      const [row] = await sql<{ days: number }>(`SELECT round(extract(epoch FROM expires_at - now()) / 86400)::int AS days FROM web_sessions`);
      expect(row?.days).toBe(30);
      // The browser's cookie slides with it, else it would end 30 days after the sign-in.
      expect(setCookies(res).get('crewdeck_session')).toMatch(new RegExp(`^${cookie}; Max-Age=2592000; Path=/; HttpOnly; SameSite=Lax`));
      expect(setCookies(again).has('crewdeck_session')).toBe(false);
    });
  });

  it('refuses with 401 auth.origin a POST of the session from another origin, or without one', async () => {
    const cookie = await signedIn();

    await expectEnvelope(await call('/api/github/token', cookie, { method: 'POST', headers: { origin: 'https://evil.example' } }), 401, 'auth.origin');
    await expectEnvelope(await fetch(`${url}/api/auth/logout`, { method: 'POST', headers: { cookie } }), 401, 'auth.origin');
    expect((await call('/api/me', cookie)).status).toBe(200);
  });

  it('closes the sockets of the session it logs out, and keeps the other sessions’', async () => {
    const cookie = await signedIn();
    const other = await signedIn();
    const mine = await socket(cookie);
    const theirs = await socket(other);

    expect((await call('/api/auth/logout', cookie, { method: 'POST' })).status).toBe(204);

    expect(await mine.closed()).toEqual({ code: WS_CLOSE.unauthorized, reason: 'revoked' });
    theirs.send({ type: 'ping' });
    await expect(theirs.next('pong')).resolves.toEqual({ type: 'pong' });
  });

  it('logs out with 204, clears the cookie, and refuses the same cookie after', async () => {
    const cookie = await signedIn();

    const res = await call('/api/auth/logout', cookie, { method: 'POST' });

    expect(res.status).toBe(204);
    expect(setCookies(res).get('crewdeck_session')).toMatch(/^crewdeck_session=; Max-Age=0; Path=\//);
    await expectEnvelope(await call('/api/me', cookie), 401, 'auth.required');
    expect((await call('/api/auth/logout', cookie, { method: 'POST' })).status).toBe(204);
  });

  it('keeps another Pilote’s WebSession out of a scoped query', async () => {
    await signedIn();
    const [octocat] = await sql<{ id: string }>('SELECT id FROM pilots');
    const prisma = new PrismaService(parseEnv({ CREWDECK_ENV: 'test', DATABASE_URL: databaseUrl }));
    try {
      const other = newId();
      await prisma.scoped.pilot.create({ data: { id: other, githubUserId: 1n, login: 'other', timeZone: 'UTC' } });

      const [session] = await sql<{ id: string }>('SELECT id FROM web_sessions');

      const seen = await runInPilotScope(other, () => prisma.scoped.webSession.findMany());
      const byId = await runInPilotScope(other, () => prisma.scoped.webSession.findFirst({ where: { id: session?.id } }));
      const mine = await runInPilotScope(octocat?.id ?? '', () => prisma.scoped.webSession.findMany());

      expect(seen).toEqual([]);
      expect(byId).toBeNull();
      expect(mine.map((row) => row.id)).toEqual([session?.id]);
    } finally {
      await prisma.onModuleDestroy();
    }
  });
});
