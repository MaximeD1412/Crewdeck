import { createHash } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import pg from 'pg';
import { inject } from 'vitest';
import { zEmailLinkVerified, zMe } from '@crewdeck/contracts';
import { MAILER } from '../../src/auth/mail/mailer.js';
import { EmailLinkLimiter } from '../../src/auth/email/email-link-limiter.js';
import { EmailLoginTokensSweep } from '../../src/auth/email/email-login-tokens.sweep.js';
import { parseEnv } from '../../src/config/env.js';
import { MemoryMailer } from '../../src/auth/mail/memory-mailer.js';
import type { SentMail } from '../../src/testing/fake-mailer.js';
import { FAKES, type Fakes } from '../../src/testing/fakes.js';
import { authKeysEnv } from '../github-app.js';
import { expectEnvelope, expectFields, startApp } from '../route-baseline.js';

const databaseUrl = inject('databaseUrl');
const APP_URL = 'https://crewdeck.example';
const ADDRESS = 'pilote@example.com';

const sql = async <T extends pg.QueryResultRow>(text: string, values: unknown[] = []): Promise<T[]> => {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    return (await client.query<T>(text, values)).rows;
  } finally {
    await client.end();
  }
};

const LINK = /^https:\/\/crewdeck\.example\/connexion\/lien#([A-Za-z0-9_-]{43})$/;

/** The token of the link `mail` carries. */
const tokenOf = (mail: SentMail | undefined): string => {
  const link = mail?.text.match(/https:\/\/\S+#[A-Za-z0-9_-]{43}/)?.[0] ?? '';
  return LINK.exec(link)?.[1] ?? '';
};

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

describe('sign in by a link sent by email, against PostgreSQL', () => {
  let app: INestApplication;
  let url: string;
  let fakes: Fakes;
  const lines: string[] = [];

  beforeAll(async () => {
    const env = parseEnv({ CREWDECK_ENV: 'test', DATABASE_URL: databaseUrl, CREWDECK_FAKES: '1', PUBLIC_URL: APP_URL, ...authKeysEnv() });
    ({ app, url } = await startApp(env, { logs: { write: (line: string) => lines.push(line) } }));
    fakes = app.get<Fakes>(FAKES);
  });

  afterAll(async () => {
    await sql('TRUNCATE pilots, email_login_tokens CASCADE');
    await app.close();
  });

  beforeEach(async () => {
    await sql('TRUNCATE pilots, email_login_tokens CASCADE');
    await fakes.mail.reset();
    app.get(EmailLinkLimiter).reset();
    lines.length = 0;
  });

  /** A call of the page: its Origin, JSON. */
  const post = (path: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> =>
    fetch(`${url}${path}`, {
      method: 'POST',
      headers: { origin: APP_URL, 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });

  const request = (email = ADDRESS, headers: Record<string, string> = {}): Promise<Response> =>
    post('/api/auth/email', { email, next: '/idees' }, headers);

  const verify = (token: string, timeZone = 'Europe/Paris'): Promise<Response> => post('/api/auth/email/verify', { token, timeZone });

  /** Requests a link for `email` and returns its token, read from the mail. */
  const linkFor = async (email = ADDRESS): Promise<string> => {
    expect((await request(email)).status).toBe(204);
    return tokenOf(fakes.mail.sentTo(email)[0]);
  };

  /** The `crewdeck_session=<token>` a response sets. */
  const sessionOf = (res: Response): string =>
    res.headers.getSetCookie().find((line) => line.startsWith('crewdeck_session='))?.split(';')[0] ?? '';

  describe('POST /api/auth/email', () => {
    it('answers 204 for a new address, stores only the hash of the token, and mails the link to /connexion/lien', async () => {
      const res = await request('  Pilote@Example.COM ');

      expect(res.status).toBe(204);
      const mails = fakes.mail.sentTo(ADDRESS);
      expect(mails).toHaveLength(1);
      expect(mails[0]).toMatchObject({ to: ADDRESS, subject: 'Ton lien de connexion à Crewdeck' });
      const token = tokenOf(mails[0]);
      expect(token).toHaveLength(43);
      expect(mails[0]?.html).toContain(`href="${APP_URL}/connexion/lien#${token}"`);
      const rows = await sql<{ email: string; token_hash: string; next: string; created_at: Date; expires_at: Date; used_at: Date | null }>(
        'SELECT * FROM email_login_tokens',
      );
      expect(rows).toEqual([expect.objectContaining({ email: ADDRESS, token_hash: sha256(token), next: '/idees', used_at: null })]);
      expect(rows[0] && rows[0].expires_at.getTime() - rows[0].created_at.getTime()).toBe(15 * 60 * 1000);
      expect(JSON.stringify(rows)).not.toContain(token);
      expect(await sql('SELECT id FROM pilots')).toEqual([]);
    });

    it('answers the same 204 and mail for an address that has a Pilote', async () => {
      await verify(await linkFor());
      await fakes.mail.reset();

      const res = await request();

      expect(res.status).toBe(204);
      expect(fakes.mail.sentTo(ADDRESS)).toHaveLength(1);
    });

    it('stores /a-toi for a next outside the site', async () => {
      await post('/api/auth/email', { email: ADDRESS, next: '//evil.example' });

      expect(await sql('SELECT next FROM email_login_tokens')).toEqual([{ next: '/a-toi' }]);
    });

    it('refuses an invalid address with 400 and fields.email', async () => {
      const fields = await expectFields(await request('not-an-address'), ['email']);

      expect(fields.email).toBe('Adresse e-mail invalide.');
      expect(fakes.mail.sentTo('not-an-address')).toEqual([]);
    });

    it('answers 429 auth.too-many-requests to the sixth link for one address within an hour', async () => {
      for (let i = 0; i < 5; i++) expect((await request(ADDRESS, { 'x-forwarded-for': `203.0.113.${i}` })).status).toBe(204);

      const envelope = await expectEnvelope(await request(ADDRESS, { 'x-forwarded-for': '203.0.113.9' }), 429, 'auth.too-many-requests');

      expect(envelope.message).toBe('Trop de liens demandés : réessaie dans une heure.');
      expect(fakes.mail.sentTo(ADDRESS)).toHaveLength(5);
    });

    it('counts the links of an address older than an hour out', async () => {
      for (let i = 0; i < 5; i++) await request();
      await sql("UPDATE email_login_tokens SET created_at = now() - interval '61 minutes'");

      expect((await request()).status).toBe(204);
    });

    it('answers 429 auth.too-many-requests to the twenty-first link from one IP within an hour', async () => {
      const from = { 'x-forwarded-for': '198.51.100.7' };
      for (let i = 0; i < 20; i++) expect((await request(`pilote${i}@example.com`, from)).status).toBe(204);

      await expectEnvelope(await request('pilote20@example.com', from), 429, 'auth.too-many-requests');
      expect((await request('pilote20@example.com', { 'x-forwarded-for': '198.51.100.8' })).status).toBe(204);
    });

    it('answers 500 auth.mail-unavailable and leaves no row when the transport refuses the mail', async () => {
      fakes.mail.failNext(new Error(`550 <${ADDRESS}> relay refused`));

      const envelope = await expectEnvelope(await request(), 500, 'auth.mail-unavailable');

      expect(envelope.message).toBe('L’e-mail n’a pas pu partir, réessaie dans un instant.');
      expect(await sql('SELECT id FROM email_login_tokens')).toEqual([]);
      expect(lines.join('\n')).not.toContain(ADDRESS);
    });

    it('refuses with 401 auth.origin a request from another origin, or without one, even without a cookie', async () => {
      await expectEnvelope(await request(ADDRESS, { origin: 'https://evil.example' }), 401, 'auth.origin');
      const bare = await fetch(`${url}/api/auth/email`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: ADDRESS, next: '/' }),
      });
      await expectEnvelope(bare, 401, 'auth.origin');
      expect(fakes.mail.sentTo(ADDRESS)).toEqual([]);
    });
  });

  describe('POST /api/auth/email/verify', () => {
    it('signs a new address up: a Pilote with its email Identité and its local part as displayName, the cookie, next', async () => {
      const token = await linkFor('ada.lovelace@example.com');

      const res = await verify(token, 'America/Toronto');

      expect(res.status).toBe(200);
      expect(zEmailLinkVerified.parse(await res.json())).toEqual({ next: '/idees' });
      const cookie = sessionOf(res);
      expect(cookie).toMatch(/^crewdeck_session=[\w-]{43}$/);
      const pilots = await sql<{ id: string; display_name: string; time_zone: string; github_user_id: string | null }>('SELECT * FROM pilots');
      expect(pilots).toEqual([expect.objectContaining({ display_name: 'ada.lovelace', time_zone: 'America/Toronto', github_user_id: null })]);
      expect(await sql('SELECT pilot_id, provider, subject, email, login FROM pilot_identities')).toEqual([
        { pilot_id: pilots[0]?.id, provider: 'email', subject: 'ada.lovelace@example.com', email: 'ada.lovelace@example.com', login: null },
      ]);
      const me = await fetch(`${url}/api/me`, { headers: { cookie } });
      expect(zMe.parse(await me.json())).toMatchObject({
        id: pilots[0]?.id,
        displayName: 'ada.lovelace',
        identities: [{ provider: 'email', label: 'ada.lovelace@example.com' }],
      });
    });

    it('signs a known address in as its Pilote, with no second Pilote', async () => {
      await verify(await linkFor());
      const [pilot] = await sql<{ id: string }>('SELECT id FROM pilots');

      const res = await verify(await linkFor(), 'Asia/Tokyo');

      expect(res.status).toBe(200);
      expect(await sql('SELECT id, time_zone FROM pilots')).toEqual([{ id: pilot?.id, time_zone: 'Europe/Paris' }]);
      expect(await sql('SELECT pilot_id FROM web_sessions')).toHaveLength(2);
    });

    it('cuts the displayName of a long local part to 39 characters', async () => {
      const local = 'a'.repeat(60);

      await verify(await linkFor(`${local}@example.com`));

      expect(await sql('SELECT display_name FROM pilots')).toEqual([{ display_name: 'a'.repeat(39) }]);
    });

    it('takes UTC for a time zone the server does not know', async () => {
      await verify(await linkFor(), 'Mars/Olympus');

      expect(await sql('SELECT time_zone FROM pilots')).toEqual([{ time_zone: 'UTC' }]);
    });

    it('answers 422 auth.link-invalid to a link used once already', async () => {
      const token = await linkFor();
      expect((await verify(token)).status).toBe(200);

      const envelope = await expectEnvelope(await verify(token), 422, 'auth.link-invalid');

      expect(envelope.message).toBe('Ce lien de connexion n’est plus valable : demande-en un nouveau.');
      expect(await sql('SELECT id FROM web_sessions')).toHaveLength(1);
    });

    it('answers 422 auth.link-invalid to a link older than 15 minutes, and creates nothing', async () => {
      const token = await linkFor();
      await sql("UPDATE email_login_tokens SET expires_at = now() - interval '1 second'");

      await expectEnvelope(await verify(token), 422, 'auth.link-invalid');
      expect(await sql('SELECT id FROM pilots')).toEqual([]);
    });

    it('answers 422 auth.link-invalid to a made-up token', async () => {
      await linkFor();

      await expectEnvelope(await verify('A'.repeat(43)), 422, 'auth.link-invalid');
      expect(await sql('SELECT id FROM pilots')).toEqual([]);
    });

    it('opens exactly one session for two verifies of the same token at once', async () => {
      const token = await linkFor();

      const answers = await Promise.all([verify(token), verify(token), verify(token)]);

      expect(answers.map((res) => res.status).sort()).toEqual([200, 422, 422]);
      expect(await sql('SELECT id FROM web_sessions')).toHaveLength(1);
      expect(await sql('SELECT id FROM pilots')).toHaveLength(1);
    });

    it('refuses with 401 auth.origin a verify from another origin', async () => {
      const token = await linkFor();

      await expectEnvelope(await post('/api/auth/email/verify', { token, timeZone: 'UTC' }, { origin: 'https://evil.example' }), 401, 'auth.origin');
      expect((await verify(token)).status).toBe(200);
    });

    it('refuses a token that is not 43 characters of base64url with 400', async () => {
      await expectFields(await verify('short'), ['token']);
    });
  });

  it('logs neither the address nor the token of the two routes', async () => {
    const token = await linkFor();
    await verify(token);
    await request('not-an-address');
    await verify('A'.repeat(43));

    const logs = lines.join('\n');
    expect(logs).toMatch(/\/api\/auth\/email/);
    expect(logs).not.toContain(ADDRESS);
    expect(logs).not.toContain('pilote%40example.com');
    expect(logs).not.toContain('not-an-address');
    expect(logs).not.toContain(token);
  });

  it('serves the mails of an address, newest first, on /api/testing/mails', async () => {
    await request();
    await request();
    await request('autre@example.com');

    const res = await fetch(`${url}/api/testing/mails?${new URLSearchParams({ to: ADDRESS })}`);

    expect(res.status).toBe(200);
    const { items: mails } = (await res.json()) as { items: SentMail[] };
    expect(mails.map((mail) => mail.to)).toEqual([ADDRESS, ADDRESS]);
    expect(tokenOf(mails[0])).toBe(tokenOf(fakes.mail.sentTo(ADDRESS)[0]));
    expect(Date.parse(mails[0]?.sentAt ?? '')).toBeGreaterThanOrEqual(Date.parse(mails[1]?.sentAt ?? ''));
  });

  it('sweeps the links drawn more than 24 hours ago, used or not, and keeps the others', async () => {
    await verify(await linkFor('vieux@example.com'));
    await request('oublie@example.com');
    await request(ADDRESS);
    await sql(`UPDATE email_login_tokens SET created_at = now() - interval '25 hours' WHERE email <> $1`, [ADDRESS]);

    await app.get(EmailLoginTokensSweep).run();

    expect(await sql('SELECT email FROM email_login_tokens')).toEqual([{ email: ADDRESS }]);
  });
});

describe('the mailer without the fakes nor SMTP_URL', () => {
  it('keeps the mails in memory: nothing leaves the machine', async () => {
    const env = parseEnv({ CREWDECK_ENV: 'test', DATABASE_URL: databaseUrl, PUBLIC_URL: APP_URL, ...authKeysEnv() });
    const { app } = await startApp(env);
    try {
      expect(app.get(MAILER)).toBeInstanceOf(MemoryMailer);
    } finally {
      await app.close();
    }
  });
});
