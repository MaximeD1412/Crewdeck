import { EmailLinkLimiter } from './email-link-limiter.js';

const MINUTE_MS = 60_000;

describe('EmailLinkLimiter, per IP', () => {
  const limiter = (start = Date.parse('2026-11-14T09:00:00Z')) => {
    const it = new EmailLinkLimiter();
    let now = start;
    it.now = () => now;
    return { limiter: it, advance: (ms: number) => (now += ms) };
  };

  it('lets 20 requests of an IP through within an hour, and refuses the 21st with 429 auth.too-many-requests', () => {
    const { limiter: ip } = limiter();
    for (let i = 0; i < 20; i++) ip.hitIp('203.0.113.7');

    expect(() => ip.hitIp('203.0.113.7')).toThrow(expect.objectContaining({ status: 429, code: 'auth.too-many-requests' }));
    expect(() => ip.hitIp('198.51.100.1')).not.toThrow();
  });

  it('slides: a request older than an hour no longer counts', () => {
    const { limiter: ip, advance } = limiter();
    ip.hitIp('203.0.113.7');
    advance(30 * MINUTE_MS);
    for (let i = 0; i < 19; i++) ip.hitIp('203.0.113.7');
    expect(() => ip.hitIp('203.0.113.7')).toThrow();

    advance(30 * MINUTE_MS + 1);

    expect(() => ip.hitIp('203.0.113.7')).not.toThrow();
    expect(() => ip.hitIp('203.0.113.7')).toThrow();
  });

  it('forgets every IP on reset', () => {
    const { limiter: ip } = limiter();
    for (let i = 0; i < 20; i++) ip.hitIp('203.0.113.7');

    ip.reset();

    expect(() => ip.hitIp('203.0.113.7')).not.toThrow();
  });
});
