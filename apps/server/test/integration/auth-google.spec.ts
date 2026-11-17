import type { INestApplication } from '@nestjs/common';
import pg from 'pg';
import { inject } from 'vitest';
import { zMe } from '@crewdeck/contracts';
import { GOOGLE_CLIENT, OidcGoogleClient } from '../../src/auth/google/google.client.js';
import { codeChallengeOf, openOauthState } from '../../src/auth/oauth-state.js';
import { parseEnv } from '../../src/config/env.js';
import type { SentMail } from '../../src/testing/fake-mailer.js';
import { FAKES, type Fakes } from '../../src/testing/fakes.js';
import { authKeysEnv, googleEnv } from '../github-app.js';
import { startApp } from '../route-baseline.js';

const databaseUrl = inject('databaseUrl');
const APP_URL = 'https://crewdeck.example';
const ADDRESS = 'pilote@example.com';
const ACCOUNT = { sub: '110248495921238986420', email: ADDRESS, emailVerified: true };

const sql = async <T extends pg.QueryResultRow>(text: string, values: unknown[] = []): Promise<T[]> => {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    return (await client.query<T>(text, values)).rows;
  } finally {
    await client.end();
  }
};

/** The `Set-Cookie` line of each cookie a response sets, by name. */
const setCookies = (res: Response): Map<string, string> =>
  new Map(
    res.headers.getSetCookie().map((line) => {
      const [pair = ''] = line.split(';');
      return [pair.slice(0, pair.indexOf('=')), line];
    }),
  );

const cookieValue = (line: string | undefined): string => line?.split(';')[0]?.split('=').slice(1).join('=') ?? '';

describe('sign in with Google against PostgreSQL', () => {
  let app: INestApplication;
  let url: string;
  let fakes: Fakes;
  let secret: Buffer;
  const lines: string[] = [];

  beforeAll(async () => {
    const keys = authKeysEnv();
    secret = Buffer.from(keys.SESSION_SECRET ?? '', 'base64');
    const env = parseEnv({ CREWDECK_ENV: 'test', DATABASE_URL: databaseUrl, CREWDECK_FAKES: '1', PUBLIC_URL: APP_URL, ...keys });
    ({ app, url } = await startApp(env, { logs: { write: (line: string) => lines.push(line) } }));
    fakes = app.get<Fakes>(FAKES);
  });

  afterAll(async () => {
    await sql('TRUNCATE pilots, email_login_tokens CASCADE');
    await app.close();
  });

  beforeEach(async () => {
    await sql('TRUNCATE pilots, email_login_tokens CASCADE');
    fakes.google.reset();
    fakes.google.seedAccount(ACCOUNT);
    await fakes.mail.reset();
    lines.length = 0;
  });

  /** `GET /api/auth/google/start`. */
  const start = ({ timeZone = 'Europe/Paris', next = '/idees' } = {}): Promise<Response> =>
    fetch(`${url}/api/auth/google/start?${new URLSearchParams({ timeZone, next })}`, { redirect: 'manual' });

  /** Google's answer to the browser: the callback's query the fake authorize page redirects to. */
  const authorize = async (startResponse: Response): Promise<URLSearchParams> => {
    const res = await fetch(new URL(startResponse.headers.get('location') ?? '', url), { redirect: 'manual' });
    expect(res.status).toBe(302);
    const callback = new URL(res.headers.get('location') ?? '');
    expect(`${callback.origin}${callback.pathname}`).toBe(`${APP_URL}/api/auth/google/callback`);
    return callback.searchParams;
  };

  const callback = (query: URLSearchParams | Record<string, string>, oauthCookie: string | undefined): Promise<Response> =>
    fetch(`${url}/api/auth/google/callback?${new URLSearchParams(query)}`, {
      redirect: 'manual',
      headers: oauthCookie === undefined ? {} : { cookie: `crewdeck_oauth=${cookieValue(oauthCookie)}` },
    });

  /** The whole sign-in, as the browser goes through it. */
  const signIn = async (options?: Parameters<typeof start>[0]): Promise<Response> => {
    const started = await start(options);
    return callback(await authorize(started), setCookies(started).get('crewdeck_oauth'));
  };

  const sessionOf = (res: Response): string => (setCookies(res).get('crewdeck_session') ?? '').split(';')[0] ?? '';

  /** Signs `email` in by a link, as the page does: the request, then the verify of the mailed token. */
  const signInByLink = async (email = ADDRESS): Promise<Response> => {
    const headers = { origin: APP_URL, 'content-type': 'application/json' };
    const requested = await fetch(`${url}/api/auth/email`, { method: 'POST', headers, body: JSON.stringify({ email, next: '/a-toi' }) });
    expect(requested.status).toBe(204);
    const mail: SentMail | undefined = fakes.mail.sentTo(email)[0];
    const token = /#([\w-]{43})/.exec(mail?.text ?? '')?.[1] ?? '';
    return fetch(`${url}/api/auth/email/verify`, { method: 'POST', headers, body: JSON.stringify({ token, timeZone: 'Europe/Paris' }) });
  };

  describe('GET /api/auth/google/start', () => {
    it('goes to Google with the S256 challenge of the sealed verifier, the sealed nonce and the scopes openid email', async () => {
      const res = await start();

      expect(res.status).toBe(302);
      const location = new URL(res.headers.get('location') ?? '', url);
      expect(location.pathname).toBe('/fake-google/authorize');
      const oauth = setCookies(res).get('crewdeck_oauth');
      expect(oauth).toMatch(/Path=\/api\/auth\/google;/);
      expect(oauth).toMatch(/HttpOnly/);
      expect(oauth).toMatch(/Max-Age=600/);
      const sealed = openOauthState(secret, cookieValue(oauth));
      expect(sealed).toMatchObject({ timeZone: 'Europe/Paris', next: '/idees', codeVerifier: expect.stringMatching(/^[\w-]{43}$/), nonce: expect.any(String) });
      expect(Object.fromEntries(location.searchParams)).toMatchObject({
        redirect_uri: `${APP_URL}/api/auth/google/callback`,
        response_type: 'code',
        scope: 'openid email',
        state: sealed?.state,
        code_challenge: codeChallengeOf(sealed?.codeVerifier ?? ''),
        code_challenge_method: 'S256',
        nonce: sealed?.nonce,
      });
      expect(location.toString()).not.toContain(sealed?.codeVerifier);
    });
  });

  describe('GET /api/auth/google/callback', () => {
    it('signs a new Google account up: a Pilote with its google Identité, no avatar, the cookie, next', async () => {
      const res = await signIn({ timeZone: 'America/Toronto' });

      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toBe('/idees');
      const cookie = sessionOf(res);
      expect(cookie).toMatch(/^crewdeck_session=[\w-]{43}$/);
      expect(setCookies(res).get('crewdeck_oauth')).toMatch(/^crewdeck_oauth=; Max-Age=0; Path=\/api\/auth\/google;/);
      const pilots = await sql<{ id: string }>('SELECT id, display_name, avatar_url, time_zone FROM pilots');
      expect(pilots).toEqual([{ id: expect.any(String), display_name: 'pilote', avatar_url: null, time_zone: 'America/Toronto' }]);
      expect(await sql('SELECT pilot_id, provider, subject, email, login FROM pilot_identities')).toEqual([
        { pilot_id: pilots[0]?.id, provider: 'google', subject: ACCOUNT.sub, email: ADDRESS, login: null },
      ]);
      const me = await fetch(`${url}/api/me`, { headers: { cookie } });
      expect(zMe.parse(await me.json())).toMatchObject({ id: pilots[0]?.id, displayName: 'pilote', avatarUrl: null, identities: [{ provider: 'google', label: ADDRESS }] });
    });

    it('signs the same account in again as its Pilote, the address refreshed when it changed at Google', async () => {
      await signIn();
      const [pilot] = await sql<{ id: string }>('SELECT id FROM pilots');
      fakes.google.seedAccount({ ...ACCOUNT, email: 'Nouvelle@Example.com' });

      const res = await signIn({ timeZone: 'Asia/Tokyo' });

      expect(res.status).toBe(302);
      expect(await sql('SELECT id, time_zone FROM pilots')).toEqual([{ id: pilot?.id, time_zone: 'Europe/Paris' }]);
      expect(await sql('SELECT provider, subject, email FROM pilot_identities')).toEqual([{ provider: 'google', subject: ACCOUNT.sub, email: 'nouvelle@example.com' }]);
      expect(await sql('SELECT pilot_id FROM web_sessions')).toEqual([{ pilot_id: pilot?.id }, { pilot_id: pilot?.id }]);
    });

    it('signs a Pilote who signed up by a link in as themself, with a second Identité', async () => {
      expect((await signInByLink()).status).toBe(200);
      const [pilot] = await sql<{ id: string }>('SELECT id FROM pilots');
      fakes.google.seedAccount({ ...ACCOUNT, email: 'PILOTE@example.com' });

      const res = await signIn();

      expect(res.status).toBe(302);
      expect(await sql('SELECT id FROM pilots')).toEqual([{ id: pilot?.id }]);
      expect(await sql('SELECT pilot_id, provider, subject FROM pilot_identities ORDER BY provider')).toEqual([
        { pilot_id: pilot?.id, provider: 'email', subject: ADDRESS },
        { pilot_id: pilot?.id, provider: 'google', subject: ACCOUNT.sub },
      ]);
      // Signed in again by either, the same Pilote.
      await signIn();
      expect((await signInByLink()).status).toBe(200);
      expect(await sql('SELECT id FROM pilots')).toEqual([{ id: pilot?.id }]);
    });

    it('never joins a GitHub Identité by its address', async () => {
      const github = '00000000-0000-4000-8000-000000000001';
      await sql(`INSERT INTO pilots (id, display_name, time_zone) VALUES ($1, 'octocat', 'UTC')`, [github]);
      await sql(`INSERT INTO pilot_identities (id, pilot_id, provider, subject, email, login) VALUES (gen_random_uuid(), $1, 'github', '583231', $2, 'octocat')`, [github, ADDRESS]);

      await signIn();

      expect(await sql('SELECT pilot_id FROM pilot_identities WHERE provider = $1', ['google'])).not.toEqual([{ pilot_id: github }]);
      expect(await sql('SELECT id FROM pilots')).toHaveLength(2);
    });

    it('refuses an address Google has not verified with google-unverified, and creates nobody', async () => {
      fakes.google.seedAccount({ ...ACCOUNT, emailVerified: false });

      const res = await signIn();

      expect([res.status, res.headers.get('location')]).toEqual([302, '/connexion?erreur=google-unverified']);
      expect(setCookies(res).has('crewdeck_session')).toBe(false);
      expect(await sql('SELECT id FROM pilots')).toEqual([]);
    });

    it('refuses a state other than the sealed one, or no oauth cookie, with state-mismatch', async () => {
      const started = await start();
      const query = await authorize(started);

      const forged = await callback({ code: query.get('code') ?? '', state: 'another-state' }, setCookies(started).get('crewdeck_oauth'));
      const bare = await callback(query, undefined);

      expect([forged.status, forged.headers.get('location')]).toEqual([302, '/connexion?erreur=state-mismatch']);
      expect([bare.status, bare.headers.get('location')]).toEqual([302, '/connexion?erreur=state-mismatch']);
      expect(await sql('SELECT id FROM pilots')).toEqual([]);
    });

    it('refuses the oauth cookie of a GitHub sign-in, which has no verifier', async () => {
      const github = await fetch(`${url}/api/auth/github/start?timeZone=UTC&next=%2F`, { redirect: 'manual' });
      const state = new URL(github.headers.get('location') ?? '', url).searchParams.get('state') ?? '';

      const res = await callback({ code: 'fake-google-code', state }, setCookies(github).get('crewdeck_oauth'));

      expect(res.headers.get('location')).toBe('/connexion?erreur=state-mismatch');
    });

    it('comes back with denied when the Pilote refuses at Google, and with google-unavailable for another error', async () => {
      const started = await start();
      const oauth = setCookies(started).get('crewdeck_oauth');

      expect((await callback({ error: 'access_denied', state: 'x' }, oauth)).headers.get('location')).toBe('/connexion?erreur=denied');
      expect((await callback({ error: 'server_error', state: 'x' }, oauth)).headers.get('location')).toBe('/connexion?erreur=google-unavailable');
    });

    it('comes back with denied when no account is chosen at the fake Google', async () => {
      fakes.google.reset();
      const started = await start();

      const res = await callback(await authorize(started), setCookies(started).get('crewdeck_oauth'));

      expect(res.headers.get('location')).toBe('/connexion?erreur=denied');
    });

    it('comes back with google-unavailable when Google refuses the code, and logs neither the address nor the code', async () => {
      const started = await start();
      const query = await authorize(started);
      const state = query.get('state') ?? '';

      const res = await callback({ code: 'a-code-google-never-gave', state }, setCookies(started).get('crewdeck_oauth'));

      expect(res.headers.get('location')).toBe('/connexion?erreur=google-unavailable');
      expect(await sql('SELECT id FROM pilots')).toEqual([]);
      expect(lines.join('\n')).toContain('auth.google-unavailable');
      expect(lines.join('\n')).not.toContain(ADDRESS);
    });

    it('refuses a code traded twice', async () => {
      const started = await start();
      const query = await authorize(started);
      const oauth = setCookies(started).get('crewdeck_oauth');
      expect((await callback(query, oauth)).headers.get('location')).toBe('/idees');

      expect((await callback(query, oauth)).headers.get('location')).toBe('/connexion?erreur=google-unavailable');
    });
  });

  describe('POST /api/auth/email/verify, the other way', () => {
    it('signs the address of a Google Identité in as its Pilote, adding the email Identité', async () => {
      await signIn();
      const [pilot] = await sql<{ id: string }>('SELECT id FROM pilots');

      const res = await signInByLink();

      expect(res.status).toBe(200);
      expect(await sql('SELECT id FROM pilots')).toEqual([{ id: pilot?.id }]);
      const me = await fetch(`${url}/api/me`, { headers: { cookie: sessionOf(res) } });
      expect(zMe.parse(await me.json()).identities).toEqual(
        expect.arrayContaining([
          { provider: 'google', label: ADDRESS },
          { provider: 'email', label: ADDRESS },
        ]),
      );
    });
  });
});

describe('the Google client without the fakes', () => {
  it('is Google itself with GOOGLE_CLIENT_ID: start goes to accounts.google.com', async () => {
    const env = parseEnv({ CREWDECK_ENV: 'test', DATABASE_URL: databaseUrl, PUBLIC_URL: APP_URL, ...authKeysEnv(), ...googleEnv() });
    const { app, url } = await startApp(env);
    try {
      expect(app.get(GOOGLE_CLIENT)).toBeInstanceOf(OidcGoogleClient);
      const res = await fetch(`${url}/api/auth/google/start?timeZone=UTC&next=%2F`, { redirect: 'manual' });
      const location = new URL(res.headers.get('location') ?? '');
      expect(`${location.origin}${location.pathname}`).toBe('https://accounts.google.com/o/oauth2/v2/auth');
      expect(location.searchParams.get('client_id')).toBe(googleEnv().GOOGLE_CLIENT_ID);
    } finally {
      await app.close();
    }
  });

  it('is none without GOOGLE_CLIENT_ID: start comes back with google-unavailable', async () => {
    const env = parseEnv({ CREWDECK_ENV: 'test', DATABASE_URL: databaseUrl, PUBLIC_URL: APP_URL, ...authKeysEnv() });
    const { app, url } = await startApp(env);
    try {
      const res = await fetch(`${url}/api/auth/google/start?timeZone=UTC&next=%2F`, { redirect: 'manual' });
      expect([res.status, res.headers.get('location')]).toEqual([302, '/connexion?erreur=google-unavailable']);
      expect(setCookies(res).has('crewdeck_oauth')).toBe(false);
    } finally {
      await app.close();
    }
  });
});
