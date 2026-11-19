import {
  isBranchName,
  worktreeCommandsAad,
  zProjectSettings,
  zProjectSettingsOverrides,
  zProjectSettingsPatch,
  zSettingsEventPayload,
  zSettingsState,
  zWorktreeCommands,
} from '../index.js';

const PROJECT_ID = '019a6f00-0000-7000-8000-000000000011';
const b64 = (bytes: number): string => Buffer.alloc(bytes, 7).toString('base64url');
const SEALED = { key: b64(60), ciphertext: b64(80) };
const CODEX = { engine: 'codex', model: 'gpt-5.5' } as const;
const CLAUDE = { engine: 'claude-code', model: 'claude-opus-5-5' } as const;

const EFFECTIVE = {
  roles: { idea: CLAUDE, design: CLAUDE, code: CODEX, review: CLAUDE },
  customRoles: [],
  notifications: { push: true },
  timeZone: 'Europe/Paris',
};

const SETTINGS = {
  projectId: PROJECT_ID,
  effective: EFFECTIVE,
  origins: { roles: { idea: 'compte', design: 'compte', code: 'projet', review: 'compte' }, notifications: { push: 'compte' } },
  changedCount: 1,
  branches: { integration: 'develop', release: 'main' },
  worktreeCommands: SEALED,
};

describe('isBranchName', () => {
  it('accepts what git check-ref-format --branch accepts', () => {
    for (const name of ['develop', 'main', 'main-2', 'release/2026.11', 'feat/75-param', 'a', 'x'.repeat(100), 'v1.0', 'user@host']) {
      expect(isBranchName(name), name).toBe(true);
    }
  });

  it('refuses a space, `..`, ~^:?*[\\, a leading -, a trailing / or .lock, and past 100 characters', () => {
    const refused = ['', 'feat..x', 'a b', 'a~b', 'a^b', 'a:b', 'a?b', 'a*b', 'a[b', 'a\\b', '-x', 'x/', 'x.lock', 'x'.repeat(101)];
    for (const name of [...refused, 'a//b', '/x', 'x.', '.x', 'a/.b', 'a.lock/b', 'a@{b', '@', 'a\tb', 'a\u007fb']) {
      expect(isBranchName(name), JSON.stringify(name)).toBe(false);
    }
  });
});

describe('zWorktreeCommands', () => {
  it('holds both texts, each 1..4000 characters or null', () => {
    expect(zWorktreeCommands.parse({ prepare: 'pnpm install', clean: null })).toEqual({ prepare: 'pnpm install', clean: null });
    expect(zWorktreeCommands.parse({ prepare: null, clean: null })).toEqual({ prepare: null, clean: null });
    expect(zWorktreeCommands.safeParse({ prepare: '', clean: null }).success).toBe(false);
    expect(zWorktreeCommands.safeParse({ prepare: 'x'.repeat(4001), clean: null }).success).toBe(false);
    expect(zWorktreeCommands.safeParse({ prepare: 'x' }).success).toBe(false);
  });

  it('is sealed under the additional data of its Projet', () => {
    expect(worktreeCommandsAad(PROJECT_ID)).toBe(`settings:${PROJECT_ID}`);
  });
});

describe('zProjectSettingsOverrides', () => {
  it('holds only what the Projet changed: a key absent is inherited', () => {
    expect(zProjectSettingsOverrides.parse({ roles: {}, notifications: {} })).toEqual({ roles: {}, notifications: {} });
    expect(zProjectSettingsOverrides.parse({ roles: { code: CODEX, 'r-a1b2c3d4': CLAUDE }, notifications: { push: false } })).toEqual({
      roles: { code: CODEX, 'r-a1b2c3d4': CLAUDE },
      notifications: { push: false },
    });
    expect(zProjectSettingsOverrides.safeParse({ roles: { code: null }, notifications: {} }).success).toBe(false);
  });
});

describe('zProjectSettings', () => {
  it('gives the settings in effect, where each comes from, the count changed, the branches and the sealed Commandes', () => {
    expect(zProjectSettings.parse(SETTINGS)).toEqual(SETTINGS);
    expect(zProjectSettings.parse({ ...SETTINGS, worktreeCommands: null }).worktreeCommands).toBeNull();
    expect(zProjectSettings.safeParse({ ...SETTINGS, origins: { ...SETTINGS.origins, notifications: { push: 'défaut' } } }).success).toBe(false);
  });

  it('is the payload of settings.upserted for a Projet, beside the account’s settings', () => {
    expect(zSettingsEventPayload.parse({ projectSettings: SETTINGS })).toEqual({ projectSettings: SETTINGS });
    expect(zSettingsEventPayload.parse(EFFECTIVE)).toEqual(EFFECTIVE);
    expect(zSettingsEventPayload.safeParse({ projectSettings: { ...SETTINGS, changedCount: -1 } }).success).toBe(false);
  });

  it('is in the settings slice of GET /api/state, one per Projet', () => {
    expect(zSettingsState.parse({ ...EFFECTIVE, projects: [SETTINGS] })).toEqual({ ...EFFECTIVE, projects: [SETTINGS] });
    expect(zSettingsState.safeParse(EFFECTIVE).success).toBe(false);
  });
});

describe('zProjectSettingsPatch', () => {
  it('takes a Rôle’s choice or null (back to the account), push or null, a branch, the sealed Commandes or null', () => {
    const patch = {
      roles: { code: CODEX, review: null },
      notifications: { push: null },
      branches: { integration: 'main-2' },
      worktreeCommands: SEALED,
      vaultKeyVersion: 2,
    };
    expect(zProjectSettingsPatch.parse(patch)).toEqual(patch);
    expect(zProjectSettingsPatch.parse({ worktreeCommands: null })).toEqual({ worktreeCommands: null });
    expect(zProjectSettingsPatch.parse({})).toEqual({});
  });

  it('refuses an unknown key at any depth, an invalid branch on its field, an unknown Rôle id', () => {
    expect(zProjectSettingsPatch.safeParse({ optionalSteps: {} }).success).toBe(false);
    expect(zProjectSettingsPatch.safeParse({ notifications: { email: true } }).success).toBe(false);
    expect(zProjectSettingsPatch.safeParse({ roles: { pilot: null } }).success).toBe(false);
    expect(zProjectSettingsPatch.safeParse({ branches: { main: 'x' } }).success).toBe(false);
    const branch = zProjectSettingsPatch.safeParse({ branches: { integration: 'feat..x' } });
    expect(branch.error?.issues.map((issue) => [issue.path.join('.'), issue.message])).toEqual([['branches.integration', 'Ce nom de branche n’est pas valide.']]);
  });

  it('refuses a sealed item over 16 KiB', () => {
    expect(zProjectSettingsPatch.safeParse({ worktreeCommands: { key: b64(60), ciphertext: b64(16 * 1024) }, vaultKeyVersion: 1 }).success).toBe(true);
    expect(zProjectSettingsPatch.safeParse({ worktreeCommands: { key: b64(60), ciphertext: b64(16 * 1024 + 3) }, vaultKeyVersion: 1 }).success).toBe(false);
  });

  it('needs the version of the vault key the Commandes were sealed under, with them only (E2E-4)', () => {
    const sealed = { key: b64(60), ciphertext: b64(64) };
    const missing = zProjectSettingsPatch.safeParse({ worktreeCommands: sealed });
    expect(missing.error?.issues.map((issue) => issue.path.join('.'))).toEqual(['vaultKeyVersion']);
    expect(zProjectSettingsPatch.safeParse({ worktreeCommands: sealed, vaultKeyVersion: 0 }).success).toBe(false);
    expect(zProjectSettingsPatch.safeParse({ worktreeCommands: null }).success).toBe(true);
    expect(zProjectSettingsPatch.safeParse({ branches: { integration: 'develop' }, vaultKeyVersion: 1 }).success).toBe(false);
  });
});
