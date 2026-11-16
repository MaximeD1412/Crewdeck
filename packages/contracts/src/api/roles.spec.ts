import type { AiAccount } from './ai-accounts.js';
import { checkRole, usableModelsOf, withDefaultRoles, zCreateRole, zCustomRole, zRoleCheck, zRoleId } from './roles.js';
import { DEFAULT_ACCOUNT_SETTINGS, zAccountSettings, zAccountSettingsPatch } from './settings.js';

const account = (engine: AiAccount['engine'], models: AiAccount['models'], overrides: Partial<AiAccount> = {}): AiAccount => ({
  id: engine === 'codex' ? '019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6b02' : '019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6b01',
  engine,
  installed: true,
  version: '1.0.0',
  knownVersion: true,
  kind: 'subscription',
  state: 'connected',
  models,
  reportedAt: '2026-11-11T08:30:00.000Z',
  ...overrides,
});

const CLAUDE = account('claude-code', [
  { id: 'claude-opus-5-5', label: 'Opus 5.5', usable: true },
  { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5', usable: true },
  { id: 'claude-fable-5-1', label: 'Fable 5.1', usable: false, reason: 'not-in-plan' },
]);
const CODEX = account('codex', [
  { id: 'gpt-5.5-pro', label: 'GPT-5.5 Pro', usable: false, reason: 'quota-reached' },
  { id: 'gpt-5.5', label: 'GPT-5.5', usable: true },
]);
const NONE = DEFAULT_ACCOUNT_SETTINGS.roles;

describe('zRoleId', () => {
  it('takes a default Rôle or a Rôle of the Pilote’s, r- then 8 characters', () => {
    for (const id of ['idea', 'design', 'code', 'review', 'r-a1b2c3d4']) expect(zRoleId.safeParse(id).success, id).toBe(true);
  });

  it('refuses anything else', () => {
    for (const id of ['tester', 'r-a1b2c3', 'r-a1b2c3d4e', 'r-A1B2C3D4', 'R-a1b2c3d4', '']) expect(zRoleId.safeParse(id).success, id).toBe(false);
  });
});

describe('zCustomRole and zCreateRole', () => {
  it('trims the name, 1 to 40 characters', () => {
    expect(zCreateRole.parse({ name: '  Revue Codex ', engine: 'codex', model: 'gpt-5.5' }).name).toBe('Revue Codex');
    for (const name of ['', '   ', 'x'.repeat(41)]) expect(zCreateRole.safeParse({ name, engine: 'codex', model: 'gpt-5.5' }).success, name).toBe(false);
    expect(zCreateRole.safeParse({ name: 'x'.repeat(40), engine: 'codex', model: 'gpt-5.5' }).success).toBe(true);
    expect(zCustomRole.safeParse({ id: 'r-a1b2c3d4', name: 'Revue Codex', createdAt: '2026-11-11T08:30:00.000Z' }).success).toBe(true);
  });

  it('refuses a Moteur the Runner does not drive and an unknown key', () => {
    expect(zCreateRole.safeParse({ name: 'Revue Gemini', engine: 'gemini', model: 'gemini-3' }).success).toBe(false);
    expect(zCreateRole.safeParse({ name: 'Revue', engine: 'codex', model: 'gpt-5.5', id: 'r-a1b2c3d4' }).success).toBe(false);
  });
});

describe('zAccountSettings.roles', () => {
  const settings = (roles: unknown, customRoles: unknown[] = []) => ({ ...DEFAULT_ACCOUNT_SETTINGS, roles, customRoles, timeZone: 'Europe/Paris' });

  it('always has the four default Rôles, and each Rôle of the Pilote’s with its choice', () => {
    const custom = { id: 'r-a1b2c3d4', name: 'Revue Codex', createdAt: '2026-11-11T08:30:00.000Z' };
    const roles = { ...NONE, 'r-a1b2c3d4': { engine: 'codex', model: 'gpt-5.5' } };
    expect(zAccountSettings.parse(settings(roles, [custom]))).toEqual(settings(roles, [custom]));
    expect(zAccountSettings.safeParse(settings({ idea: null, design: null, code: null })).success).toBe(false);
  });

  it('refuses a key that is no Rôle id', () => {
    expect(zAccountSettings.safeParse(settings({ ...NONE, tester: null })).success).toBe(false);
  });
});

describe('zAccountSettingsPatch.roles', () => {
  it('takes any Rôle id, a default one or the Pilote’s, and only those', () => {
    expect(zAccountSettingsPatch.parse({ roles: { 'r-a1b2c3d4': { engine: 'codex', model: 'gpt-5.5' }, review: null } })).toEqual({
      roles: { 'r-a1b2c3d4': { engine: 'codex', model: 'gpt-5.5' }, review: null },
    });
    const refused = zAccountSettingsPatch.safeParse({ roles: { pilot: null } });
    expect(refused.success).toBe(false);
    expect(refused.error?.issues.map((issue) => issue.path.join('.'))).toEqual(['roles.pilot']);
  });
});

describe('usableModelsOf', () => {
  it('lists the usable models of the usable Comptes IA, Claude Code first, each Moteur’s in the order it reports them', () => {
    expect(usableModelsOf([CODEX, CLAUDE])).toEqual([
      { engine: 'claude-code', model: 'claude-opus-5-5', label: 'Opus 5.5' },
      { engine: 'claude-code', model: 'claude-sonnet-5-5', label: 'Sonnet 5.5' },
      { engine: 'codex', model: 'gpt-5.5', label: 'GPT-5.5' },
    ]);
  });

  it('leaves out a Moteur not installed or signed out', () => {
    expect(usableModelsOf([{ ...CLAUDE, installed: false }, { ...CODEX, state: 'login-required' }])).toEqual([]);
  });
});

describe('withDefaultRoles', () => {
  it('gives Claude Code to Idée, Conception and Code, and Codex to the Review, with both usable and nothing chosen', () => {
    expect(withDefaultRoles(NONE, [CLAUDE, CODEX])).toEqual({
      idea: { engine: 'claude-code', model: 'claude-opus-5-5' },
      design: { engine: 'claude-code', model: 'claude-opus-5-5' },
      code: { engine: 'claude-code', model: 'claude-opus-5-5' },
      review: { engine: 'codex', model: 'gpt-5.5' },
    });
  });

  it('gives Codex to every default Rôle when it is the only Moteur usable', () => {
    const codex = { engine: 'codex', model: 'gpt-5.5' };
    expect(withDefaultRoles(NONE, [CODEX])).toEqual({ idea: codex, design: codex, code: codex, review: codex });
  });

  it('puts the Review on another Moteur than the Code’s effective one, and keeps stored choices as stored, usable or not', () => {
    const stored = { ...NONE, code: { engine: 'codex', model: 'gpt-5.5-pro' }, 'r-a1b2c3d4': { engine: 'codex', model: 'gpt-5.5' } } as const;
    expect(withDefaultRoles(stored, [CLAUDE, CODEX])).toEqual({
      idea: { engine: 'claude-code', model: 'claude-opus-5-5' },
      design: { engine: 'claude-code', model: 'claude-opus-5-5' },
      code: { engine: 'codex', model: 'gpt-5.5-pro' },
      review: { engine: 'claude-code', model: 'claude-opus-5-5' },
      'r-a1b2c3d4': { engine: 'codex', model: 'gpt-5.5' },
    });
  });

  it('leaves a default Rôle null when no model is usable', () => {
    expect(withDefaultRoles(NONE, [{ ...CLAUDE, state: 'login-required' }])).toEqual(NONE);
  });
});

describe('checkRole', () => {
  const accounts = [CLAUDE, CODEX];

  it('says a usable choice usable', () => {
    expect(checkRole('code', { engine: 'codex', model: 'gpt-5.5' }, accounts)).toEqual({ roleId: 'code', engine: 'codex', model: 'gpt-5.5', usable: true });
  });

  it('gives the reason the Moteur reports for a model it cannot run', () => {
    expect(checkRole('review', { engine: 'codex', model: 'gpt-5.5-pro' }, accounts)).toEqual({
      roleId: 'review',
      engine: 'codex',
      model: 'gpt-5.5-pro',
      usable: false,
      reason: 'quota-reached',
    });
    expect(checkRole('idea', { engine: 'claude-code', model: 'claude-fable-5-1' }, accounts).reason).toBe('not-in-plan');
  });

  it('says why a choice cannot run otherwise: a model unknown, a Compte IA signed out, a Moteur absent, no choice at all', () => {
    expect(checkRole('idea', { engine: 'claude-code', model: 'claude-haiku-5-5' }, accounts).reason).toBe('unknown-model');
    expect(checkRole('idea', { engine: 'claude-code', model: 'claude-opus-5-5' }, [{ ...CLAUDE, state: 'login-required' }]).reason).toBe('login-required');
    expect(checkRole('idea', { engine: 'codex', model: 'gpt-5.5' }, [CLAUDE]).reason).toBe('no-engine');
    expect(checkRole('idea', { engine: 'codex', model: 'gpt-5.5' }, [{ ...CODEX, installed: false }]).reason).toBe('no-engine');
    expect(checkRole('r-zzzzzzzz', undefined, accounts)).toEqual({ roleId: 'r-zzzzzzzz', engine: null, model: null, usable: false, reason: 'no-engine' });
    expect(zRoleCheck.safeParse(checkRole('idea', null, accounts)).success).toBe(true);
  });
});
