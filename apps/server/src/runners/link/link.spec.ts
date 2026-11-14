import { LINK_ATTEMPTS_PER_MINUTE, zRunnerLink, zShortId } from '@crewdeck/contracts';
import { AppError } from '../../errors/app-error.js';
import { RunnerClock } from '../clock.js';
import { failureOf, reasonOf, toRunnerLink } from './link-code.view.js';
import { RunnerLinkLimiter } from './link-limiter.js';
import { RunnerLinkTokens } from './link-tokens.js';
import { drawShortId } from '../../ids.js';

describe('drawShortId', () => {
  it('draws 4 characters of Crockford’s base32, spread over the alphabet', () => {
    const drawn = Array.from({ length: 500 }, drawShortId);

    for (const shortId of drawn) expect(zShortId.safeParse(shortId).success, shortId).toBe(true);
    expect(new Set(drawn.join('')).size).toBeGreaterThan(28);
  });
});

describe('RunnerLinkLimiter', () => {
  const at = (clock: RunnerClock, ms: number) => {
    clock.now = () => new Date(ms);
  };

  it(`lets ${LINK_ATTEMPTS_PER_MINUTE} attempts a minute through by IP, then answers 429 until the minute slid`, () => {
    const clock = new RunnerClock();
    const limiter = new RunnerLinkLimiter(clock);
    at(clock, 0);
    for (let attempt = 0; attempt < LINK_ATTEMPTS_PER_MINUTE; attempt++) limiter.hit('203.0.113.1');

    expect(() => limiter.hit('203.0.113.1')).toThrow(expect.objectContaining({ status: 429, code: 'runner.link-rate-limited' }) as unknown as AppError);
    expect(() => limiter.hit('203.0.113.2')).not.toThrow();
    at(clock, 59_999);
    expect(() => limiter.hit('203.0.113.1')).toThrow(AppError);
    at(clock, 60_001);
    expect(() => limiter.hit('203.0.113.1')).not.toThrow();
  });
});

describe('RunnerLinkTokens', () => {
  it('gives a link’s token once', () => {
    const tokens = new RunnerLinkTokens();
    const pairing = { proof: 'p', vaultKeyVersion: 1, runnerVaultWrap: { enc: 'e', ciphertext: 'c', tag: 't' } };
    tokens.keep('link', { token: 't', pairing });

    expect(tokens.take('link')).toEqual({ token: 't', pairing });
    expect(tokens.take('link')).toBeUndefined();
  });
});

describe('the link view', () => {
  it('spells the reasons as the API does, both ways', () => {
    expect(reasonOf('already_used')).toBe('already-used');
    expect(failureOf('unsupported-system')).toBe('unsupported_system');
  });

  it('is the runner-link payload, without the secret nor the Runner’s machine', () => {
    const link = toRunnerLink({
      id: '019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6a01',
      shortId: '7KQ4',
      state: 'failed',
      failureReason: 'no_engine',
      expiresAt: new Date('2026-11-11T08:10:00.000Z'),
      runnerId: null,
      runnerPairing: null,
    });

    expect(zRunnerLink.parse(link)).toEqual({
      id: '019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6a01',
      shortId: '7KQ4',
      state: 'failed',
      failureReason: 'no-engine',
      expiresAt: '2026-11-11T08:10:00.000Z',
      runnerId: null,
      runnerPairing: null,
    });
  });
});
