import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { AppError } from '../../errors/app-error.js';
import { codeChallengeOf, newCodeVerifier } from '../oauth-state.js';
import { GOOGLE_AUTHORIZE_URL, GOOGLE_TOKEN_URL, OidcGoogleClient } from './google.client.js';

/** Every request ends here, never at Google: an unhandled one fails the test. */
const server = setupServer();

const CLIENT_ID = 'crewdeck-test.apps.googleusercontent.com';
const CLIENT_SECRET = 'test-google-secret';
const REDIRECT_URI = 'https://crewdeck.example/api/auth/google/callback';
const NOW = Date.parse('2026-11-17T10:00:00Z');

const logger = () => ({ warn: vi.fn() });
const client = (log = logger()) => new OidcGoogleClient({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET }, log, () => NOW);

const base64url = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString('base64url');

/** An `id_token` as Google's token endpoint returns it: its signature is not checked (ADR 0014, the ticket). */
const idToken = (claims: Record<string, unknown> = {}): string =>
  [
    base64url({ alg: 'RS256', kid: 'k1', typ: 'JWT' }),
    base64url({
      iss: 'https://accounts.google.com',
      aud: CLIENT_ID,
      azp: CLIENT_ID,
      sub: '110248495921238986420',
      email: 'Pilote@Example.com',
      email_verified: true,
      nonce: 'n0nce',
      iat: NOW / 1000 - 10,
      exp: NOW / 1000 + 3600,
      ...claims,
    }),
    'c2lnbmF0dXJl',
  ].join('.');

const exchange = (google = client()) =>
  google.exchangeCode({ code: '4/0Ab-code', codeVerifier: 'v3rifier', redirectUri: REDIRECT_URI, nonce: 'n0nce' });

/** Google's token endpoint answering `claims` in its `id_token`; the form it received, for the test to read. */
const tokenEndpoint = (claims: Record<string, unknown> = {}) => {
  const received: URLSearchParams[] = [];
  server.use(
    http.post(GOOGLE_TOKEN_URL, async ({ request }) => {
      received.push(new URLSearchParams(await request.text()));
      return HttpResponse.json({ access_token: 'ya29.never-kept', expires_in: 3599, scope: 'openid email', token_type: 'Bearer', id_token: idToken(claims) });
    }),
  );
  return received;
};

const expectUnavailable = async (promise: Promise<unknown>): Promise<void> => {
  await expect(promise).rejects.toBeInstanceOf(AppError);
  await expect(promise).rejects.toMatchObject({ status: 500, code: 'auth.google-unavailable', message: 'Google ne répond pas, réessaie dans un instant.' });
};

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('OidcGoogleClient.authorizeUrl', () => {
  it('asks Google for a code with PKCE (S256), the nonce, the scopes openid email and the account chooser, no offline access', () => {
    const verifier = newCodeVerifier();

    const url = new URL(client().authorizeUrl({ state: 's7ate', codeChallenge: codeChallengeOf(verifier), nonce: 'n0nce', redirectUri: REDIRECT_URI }));

    expect(`${url.origin}${url.pathname}`).toBe(GOOGLE_AUTHORIZE_URL);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      response_type: 'code',
      scope: 'openid email',
      state: 's7ate',
      code_challenge: codeChallengeOf(verifier),
      code_challenge_method: 'S256',
      nonce: 'n0nce',
      prompt: 'select_account',
    });
    expect(url.toString()).not.toContain(verifier);
  });
});

describe('OidcGoogleClient.exchangeCode', () => {
  it('trades the code and its verifier for the id_token, and gives who signed in, the address lower-cased', async () => {
    const received = tokenEndpoint();

    await expect(exchange()).resolves.toEqual({ sub: '110248495921238986420', email: 'pilote@example.com', emailVerified: true });

    expect(received).toHaveLength(1);
    expect(Object.fromEntries(received[0] ?? [])).toEqual({
      grant_type: 'authorization_code',
      code: '4/0Ab-code',
      code_verifier: 'v3rifier',
      redirect_uri: REDIRECT_URI,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
    });
  });

  it('takes the issuer without its scheme too', async () => {
    tokenEndpoint({ iss: 'accounts.google.com' });

    await expect(exchange()).resolves.toMatchObject({ sub: '110248495921238986420' });
  });

  it.each([
    [false, false],
    [undefined, false],
    ['true', true],
    ['false', false],
  ])('reads email_verified %j as %s', async (email_verified, emailVerified) => {
    tokenEndpoint({ email_verified });

    await expect(exchange()).resolves.toMatchObject({ emailVerified });
  });

  it.each([
    ['an aud of another client', { aud: 'someone-else.apps.googleusercontent.com' }],
    ['a nonce other than the one sent', { nonce: 'another-nonce' }],
    ['no nonce', { nonce: undefined }],
    ['another issuer', { iss: 'https://evil.example' }],
    ['an expired token', { exp: NOW / 1000 - 1 }],
    ['no address', { email: undefined }],
    ['no sub', { sub: undefined }],
  ])('refuses %s with auth.google-unavailable', async (_case, claims) => {
    tokenEndpoint(claims);
    const log = logger();

    await expectUnavailable(exchange(client(log)));

    expect(log.warn).toHaveBeenCalledOnce();
    expect(JSON.stringify(log.warn.mock.calls)).not.toContain('Pilote@Example.com');
  });

  it('refuses an id_token that is not a JWT', async () => {
    server.use(http.post(GOOGLE_TOKEN_URL, () => HttpResponse.json({ access_token: 'x', id_token: 'not-a-jwt' })));

    await expectUnavailable(exchange());
  });

  it('refuses a response without an id_token', async () => {
    server.use(http.post(GOOGLE_TOKEN_URL, () => HttpResponse.json({ access_token: 'x' })));

    await expectUnavailable(exchange());
  });

  it('refuses a code Google refuses (400 invalid_grant)', async () => {
    server.use(http.post(GOOGLE_TOKEN_URL, () => HttpResponse.json({ error: 'invalid_grant', error_description: 'Bad Request' }, { status: 400 })));

    await expectUnavailable(exchange());
  });

  it('refuses Google down, or the network failing', async () => {
    server.use(http.post(GOOGLE_TOKEN_URL, () => new HttpResponse('upstream', { status: 503 })));
    await expectUnavailable(exchange());

    server.use(http.post(GOOGLE_TOKEN_URL, () => HttpResponse.error()));
    await expectUnavailable(exchange());
  });
});
