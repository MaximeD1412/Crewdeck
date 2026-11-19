import { EMAIL_LINK_TTL_SECONDS, zEmailLinkRequest, zEmailLinkVerified, zEmailLinkVerify, zIdentityProvider } from '../index.js';

const TOKEN = 'a'.repeat(40) + '-_Z';

describe('zIdentityProvider', () => {
  it('is email, google or github', () => {
    expect(zIdentityProvider.options).toEqual(['email', 'google', 'github']);
  });
});

describe('zEmailLinkRequest', () => {
  it('trims and lower-cases the address', () => {
    expect(zEmailLinkRequest.parse({ email: '  Pilote@Example.COM ', next: '/idees' })).toEqual({ email: 'pilote@example.com', next: '/idees' });
  });

  it('refuses what is not an address, with « Adresse e-mail invalide. »', () => {
    for (const email of ['', 'pilote', 'pilote@', '@example.com', `${'a'.repeat(250)}@example.com`]) {
      const parsed = zEmailLinkRequest.safeParse({ email, next: '/a-toi' });
      expect(parsed.success, email).toBe(false);
      expect(parsed.error?.issues[0]).toMatchObject({ path: ['email'], message: 'Adresse e-mail invalide.' });
    }
  });
});

describe('zEmailLinkVerify', () => {
  it('takes a token of 43 base64url characters and the browser’s time zone', () => {
    expect(zEmailLinkVerify.parse({ token: TOKEN, timeZone: 'Europe/Paris' })).toEqual({ token: TOKEN, timeZone: 'Europe/Paris' });
  });

  it('refuses a token of another length or alphabet', () => {
    for (const token of ['', TOKEN.slice(1), `${TOKEN}a`, `${TOKEN.slice(1)}+`, `${TOKEN.slice(1)}=`]) {
      expect(zEmailLinkVerify.safeParse({ token, timeZone: 'UTC' }).success, token).toBe(false);
    }
  });
});

describe('zEmailLinkVerified', () => {
  it('is where the page goes once signed in', () => {
    expect(zEmailLinkVerified.parse({ next: '/demarrage' })).toEqual({ next: '/demarrage' });
  });

  it('says a link lasts 15 minutes', () => {
    expect(EMAIL_LINK_TTL_SECONDS).toBe(900);
  });
});
