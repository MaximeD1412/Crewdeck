import { randomBytes } from 'node:crypto';
import { OAUTH_TTL_SECONDS, openOauthState, safeNext, safeTimeZone, sameState, sealOauthState } from './oauth-state.js';

const secret = randomBytes(32);
const value = { state: 's7ate', timeZone: 'Europe/Paris', next: '/idees' };

describe('the oauth cookie', () => {
  it('opens what this secret sealed, for 10 minutes', () => {
    const now = Date.now();
    const sealed = sealOauthState(secret, value, now);

    expect(openOauthState(secret, sealed, now + OAUTH_TTL_SECONDS * 1000 - 1)).toEqual(value);
    expect(openOauthState(secret, sealed, now + OAUTH_TTL_SECONDS * 1000)).toBeUndefined();
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

describe('safeTimeZone', () => {
  it('keeps an IANA time zone, else takes UTC', () => {
    expect(safeTimeZone('America/New_York')).toBe('America/New_York');
    expect(safeTimeZone('Mars/Olympus')).toBe('UTC');
    expect(safeTimeZone(undefined)).toBe('UTC');
  });
});
