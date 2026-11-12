import { type EngineCapabilities, zAiAccount } from '@crewdeck/contracts';
import { rowOf, toAiAccount } from './ai-account.view.js';

const CLAUDE: EngineCapabilities = {
  engine: 'claude-code',
  installed: true,
  knownVersion: false,
  account: { kind: 'api-key', state: 'login-required' },
  models: [{ id: 'opus', label: 'Opus', usable: false, reason: 'quota-reached' }],
  features: { interrupt: true, resume: true, questions: true, permissions: true },
};

describe('an ai_accounts row', () => {
  it('stores the Moteur’s kind and state in Prisma’s spelling, and gives them back as the contracts spell them', () => {
    const reportedAt = new Date('2026-11-11T08:00:00.000Z');
    const row = rowOf(CLAUDE, reportedAt);

    expect(row).toMatchObject({ engine: 'claude_code', kind: 'api_key', state: 'login_required', version: null });
    expect(zAiAccount.parse(toAiAccount({ id: '019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6a00', ...row }))).toEqual({
      id: '019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6a00',
      engine: 'claude-code',
      installed: true,
      version: null,
      knownVersion: false,
      kind: 'api-key',
      state: 'login-required',
      models: [{ id: 'opus', label: 'Opus', usable: false, reason: 'quota-reached' }],
      reportedAt: '2026-11-11T08:00:00.000Z',
    });
  });

  it('keeps of the account its kind and state only, and of a model what zAiAccountModel reads', () => {
    const leaky = {
      ...CLAUDE,
      account: { ...CLAUDE.account, apiKey: 'sk-secret' },
      models: [{ ...CLAUDE.models[0], token: 'sk-secret' }],
    } as unknown as EngineCapabilities;

    expect(JSON.stringify(rowOf(leaky, new Date()))).not.toContain('sk-secret');
  });
});
