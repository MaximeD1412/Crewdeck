import { createHmac, randomBytes } from 'node:crypto';
import { OAUTH_TTL_SECONDS, openOauthState, safeNext, safeTimeZone, sameState, sealOauthState, withError } from './oauth-state.js';

const secret = randomBytes(32);
const sign = (body: string): string => createHmac('sha256', secret).update(body).digest('base64url');
const value = { intent: 'sign-in', state: 's7ate', timeZone: 'Europe/Paris', next: '/idees' } as const;
const link = { intent: 'link', state: 's7ate', pilotId: '01900000-0000-7000-8000-00000000000a', next: '/parametres' } as const;

describe('the oauth cookie', () => {
  it('opens what this secret sealed, for 10 minutes', () => {
    const now = Date.now();
    const sealed = sealOauthState(secret, value, now);

    expect(openOauthState(secret, sealed, now + OAUTH_TTL_SECONDS * 1000 - 1)).toEqual(value);
    expect(openOauthState(secret, sealed, now + OAUTH_TTL_SECONDS * 1000)).toBeUndefined();
  });

  it('opens a link with its Pilote, and reads a cookie sealed before the intents as a sign-in', () => {
    expect(openOauthState(secret, sealOauthState(secret, link))).toEqual(link);
    const before = { state: value.state, timeZone: value.timeZone, next: value.next };
    const body = Buffer.from(JSON.stringify({ ...before, exp: Date.now() + 60_000 })).toString('base64url');

    expect(openOauthState(secret, `${body}.${sign(body)}`)).toEqual(value);
  });

  it('refuses a link sealed without its Pilote', () => {
    const body = Buffer.from(JSON.stringify({ intent: 'link', state: 's', next: '/parametres', exp: Date.now() + 60_000 })).toString('base64url');

    expect(openOauthState(secret, `${body}.${sign(body)}`)).toBeUndefined();
  });

  it('refuses a cookie of another secret, changed, cut or absent', () => {
    const sealed = sealOauthState(secret, value);
    const [body = '', mac = ''] = sealed.split('.');
    const forged = Buffer.from(JSON.stringify({ ...value, next: '/other', exp: Date.now() + 60_000 })).toString('base64url');

    expect(openOauthState(randomBytes(32), sealed)).toBeUndefined();
    expect(openOauthState(secret, `${forged}.${mac}`)).toBeUndefined();
    expect(openOauthState(secret, body)).toBeUndefined();
    expect(openOauthState(secret, `${body}.${mac.slice(1)}`)).toBeUndefined();
    expect(openOauthState(secret, `${sealed}.x`)).toBeUndefined();
    expect(openOauthState(secret, undefined)).toBeUndefined();
  });

  it('compares states whole', () => {
    expect(sameState('abc', 'abc')).toBe(true);
    expect(sameState('abc', 'abd')).toBe(false);
    expect(sameState('abc', 'ab')).toBe(false);
  });
});

describe('safeNext', () => {
  it.each(['/a-toi', '/idees?x=1', '/parametres/composants#c'])('keeps the path %s', (next) => {
    expect(safeNext(next)).toBe(next);
  });

  it.each(['//evil.example', '/\\evil.example', 'https://evil.example', 'idees', '', undefined])('takes /a-toi for %s', (next) => {
    expect(safeNext(next)).toBe('/a-toi');
  });
});

describe('withError', () => {
  it.each([
    ['/parametres', '/parametres?erreur=denied'],
    ['/demarrage?x=1#c', '/demarrage?x=1&erreur=denied#c'],
    ['/parametres?erreur=github-unavailable', '/parametres?erreur=denied'],
  ])('adds erreur to %s', (next, expected) => {
    expect(withError(next, 'denied')).toBe(expected);
  });
});

describe('safeTimeZone', () => {
  it('keeps an IANA time zone, else takes UTC', () => {
    expect(safeTimeZone('America/New_York')).toBe('America/New_York');
    expect(safeTimeZone('Mars/Olympus')).toBe('UTC');
    expect(safeTimeZone(undefined)).toBe('UTC');
  });
});
