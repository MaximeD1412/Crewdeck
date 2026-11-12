import { eventPayloadSchema, isUsableAccount, STATE_SLICES, zAiAccount, zAiAccountList } from '../index.js';

const ACCOUNT = {
  id: '019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6b01',
  engine: 'claude-code',
  installed: true,
  version: '2.1.319',
  knownVersion: true,
  kind: 'subscription',
  state: 'connected',
  models: [
    { id: 'claude-opus-5-5', label: 'Opus 5.5', usable: true },
    { id: 'claude-fable-5-1', label: 'Fable 5.1', usable: false, reason: 'not-in-plan' },
  ],
  reportedAt: '2026-11-11T08:30:00.000Z',
};

describe('zAiAccount', () => {
  it('is an item of GET /api/ai-accounts, the payload of ai-account.upserted, and the ai-account slice', () => {
    expect(zAiAccountList.parse({ items: [ACCOUNT] })).toEqual({ items: [ACCOUNT] });
    expect(eventPayloadSchema('ai-account.upserted')?.parse(ACCOUNT)).toEqual(ACCOUNT);
    expect(STATE_SLICES['ai-account'].parse([ACCOUNT])).toEqual([ACCOUNT]);
  });

  it('holds no credential: a key given with it is not kept', () => {
    expect(zAiAccount.parse({ ...ACCOUNT, apiKey: 'sk-ant-secret' })).not.toHaveProperty('apiKey');
  });

  it('is of a Moteur the Runner drives, its models unusable for a known reason', () => {
    expect(zAiAccount.safeParse({ ...ACCOUNT, engine: 'gemini' }).success).toBe(false);
    expect(zAiAccount.safeParse({ ...ACCOUNT, models: [{ id: 'x', label: 'X', usable: false, reason: 'tired' }] }).success).toBe(false);
    expect(zAiAccount.parse({ ...ACCOUNT, version: null }).version).toBeNull();
  });
});

describe('isUsableAccount', () => {
  it('is a connected Compte IA of an installed Moteur with a usable model', () => {
    expect(isUsableAccount(zAiAccount.parse(ACCOUNT))).toBe(true);
    expect(isUsableAccount(zAiAccount.parse({ ...ACCOUNT, installed: false }))).toBe(false);
    expect(isUsableAccount(zAiAccount.parse({ ...ACCOUNT, state: 'login-required' }))).toBe(false);
    expect(isUsableAccount(zAiAccount.parse({ ...ACCOUNT, models: [{ id: 'gpt-5.5', label: 'GPT-5.5', usable: false, reason: 'quota-reached' }] }))).toBe(false);
  });

  it('stays usable on a version the adapter does not know (risk IA-3)', () => {
    expect(isUsableAccount(zAiAccount.parse({ ...ACCOUNT, knownVersion: false }))).toBe(true);
  });
});
