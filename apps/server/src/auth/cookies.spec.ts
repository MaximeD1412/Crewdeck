import { clearCookie, readCookie, serializeCookie } from './cookies.js';

describe('cookies', () => {
  it('reads one cookie of the header', () => {
    expect(readCookie('a=1; crewdeck_session=t0k=n; b=2', 'crewdeck_session')).toBe('t0k=n');
    expect(readCookie('xcrewdeck_session=1', 'crewdeck_session')).toBeUndefined();
    expect(readCookie(undefined, 'crewdeck_session')).toBeUndefined();
  });

  it('writes HttpOnly, SameSite=Lax cookies, Secure on the deployed servers', () => {
    expect(serializeCookie('n', 'v', { maxAge: 60, path: '/', secure: false })).toBe('n=v; Max-Age=60; Path=/; HttpOnly; SameSite=Lax');
    expect(serializeCookie('n', 'v', { maxAge: 60, path: '/', secure: true })).toMatch(/; Secure$/);
    expect(clearCookie('n', { path: '/x', secure: false })).toBe('n=; Max-Age=0; Path=/x; HttpOnly; SameSite=Lax');
  });
});
