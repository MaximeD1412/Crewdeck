import {
  LINK_CODE_SECRET_LENGTH,
  eventPayloadSchema,
  splitLinkCode,
  zLinkCode,
  zRunnerLink,
  zRunnerLinkConfirm,
  zRunnerLinkFailure,
  zRunnerLinkRequest,
  zRunnerLinkStatus,
  zShortId,
} from '../index.js';

const SECRET = 'M2PXA7QK9VZ3T8W4R6N1B5C0DE';
const LINK = {
  id: '019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6a01',
  shortId: '7KQ4',
  state: 'waiting',
  failureReason: null,
  expiresAt: '2026-11-11T08:10:00.000Z',
  runnerPairing: null,
};

describe('the link code', () => {
  it('is a short id of 4 Crockford characters, a dash and a secret of 26 (128 bits)', () => {
    expect(SECRET).toHaveLength(LINK_CODE_SECRET_LENGTH);
    expect(zLinkCode.parse(`7KQ4-${SECRET}`)).toBe(`7KQ4-${SECRET}`);
    expect(splitLinkCode(`7kq4-${SECRET.toLowerCase()}`)).toEqual({ shortId: '7KQ4', secret: SECRET });
  });

  it('refuses the mockup’s short code, a letter outside Crockford’s alphabet, a missing part', () => {
    for (const code of ['7KQ4-M2PX', `7KQU-${SECRET}`, SECRET, `7KQ4${SECRET}`]) expect(splitLinkCode(code), code).toBeNull();
    expect(zShortId.safeParse('7KQI').success).toBe(false);
  });
});

describe('the link API', () => {
  const request = { shortId: '7KQ4', machine: 'atelier', os: 'linux', arch: 'amd64', wsl: true, runnerVersion: '0.1.0', engines: ['claude'] };

  it('takes the machine of the Runner that links, its Moteurs possibly none', () => {
    expect(zRunnerLinkRequest.parse(request)).toEqual(request);
    expect(zRunnerLinkRequest.parse({ ...request, engines: [] }).engines).toEqual([]);
    expect(zRunnerLinkRequest.safeParse({ ...request, os: 'windows' }).success).toBe(false);
    expect(zRunnerLinkRequest.safeParse({ ...request, shortId: `7KQ4-${SECRET}` }).success).toBe(false);
  });

  it('reports an unsupported system with the raw uname values', () => {
    expect(zRunnerLinkFailure.parse({ shortId: '7KQ4', reason: 'unsupported-system', os: 'FreeBSD', arch: 'riscv64' })).toMatchObject({ os: 'FreeBSD' });
    expect(zRunnerLinkFailure.safeParse({ shortId: '7KQ4', reason: 'no-engine', os: 'Linux', arch: 'x86_64' }).success).toBe(false);
  });

  it('confirms with an opaque pairing and the seq of the code', () => {
    expect(zRunnerLinkConfirm.parse({ pairing: {}, seq: '12' })).toEqual({ pairing: {}, seq: 12 });
    expect(zRunnerLinkConfirm.safeParse({ pairing: 'clair', seq: 12 }).success).toBe(false);
  });

  it('answers the binary pending, linked with its token, or failed with a reason', () => {
    expect(zRunnerLinkStatus.parse({ state: 'pending' })).toEqual({ state: 'pending' });
    expect(zRunnerLinkStatus.parse({ state: 'linked', runnerId: LINK.id, token: 'a'.repeat(43), pairing: {} })).toMatchObject({ state: 'linked' });
    expect(zRunnerLinkStatus.parse({ state: 'failed', reason: 'expired' })).toMatchObject({ reason: 'expired' });
    expect(zRunnerLinkStatus.safeParse({ state: 'waiting' }).success).toBe(false);
  });
});

describe('zRunnerLink', () => {
  it('is the runner-link slice and the payload of runner-link.upserted, without the secret', () => {
    expect(zRunnerLink.parse(LINK)).toEqual(LINK);
    expect(eventPayloadSchema('runner-link.upserted')?.parse({ ...LINK, state: 'failed', failureReason: 'no-engine' })).toMatchObject({ failureReason: 'no-engine' });
    expect(zRunnerLink.safeParse({ ...LINK, state: 'lost' }).success).toBe(false);
  });
});
