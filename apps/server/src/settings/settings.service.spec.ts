import type { AccountSettings, AiAccount, EffectiveSettings } from '@crewdeck/contracts';
import { isKnownTimeZone, mergeSettings, NO_OVERRIDES, patched, projectSettingsOf, SettingsService } from './settings.service.js';

const SETTINGS: AccountSettings = {
  roles: { idea: null, design: { engine: 'codex', model: 'gpt-5' }, code: null, review: null },
  customRoles: [],
  notifications: { push: false },
  timeZone: 'Europe/Paris',
};

describe('isKnownTimeZone', () => {
  it('knows the IANA zones, and the names a browser may give for them', () => {
    for (const zone of ['Europe/Paris', 'America/Montreal', 'Asia/Tokyo', 'UTC', 'Asia/Kolkata', 'Asia/Calcutta']) expect(isKnownTimeZone(zone), zone).toBe(true);
  });

  it('refuses a name no IANA zone has, an offset, an empty string', () => {
    for (const zone of ['Mars/Olympus', 'Europe/Pariss', '+01:00', 'GMT+1', '']) expect(isKnownTimeZone(zone), zone).toBe(false);
  });
});

describe('patched', () => {
  it('changes only the fields the patch gives, role by role', () => {
    expect(patched(SETTINGS, { roles: { code: { engine: 'claude-code', model: 'opus' } } })).toEqual({
      ...SETTINGS,
      roles: { ...SETTINGS.roles, code: { engine: 'claude-code', model: 'opus' } },
    });
    expect(patched(SETTINGS, { notifications: { push: true }, timeZone: 'Asia/Tokyo' })).toEqual({ ...SETTINGS, notifications: { push: true }, timeZone: 'Asia/Tokyo' });
  });

  it('sets a role back to its default with null, and leaves everything as is with an empty patch', () => {
    expect(patched(SETTINGS, { roles: { design: null } }).roles.design).toBeNull();
    expect(patched(SETTINGS, {})).toEqual(SETTINGS);
  });
});

describe('SettingsService.effective', () => {
  it('takes the Pilote and, optionally, a Projet: the one function a module reads its settings with', () => {
    expectTypeOf<SettingsService['effective']>().parameters.toEqualTypeOf<[pilotId: string, projectId?: string]>();
    expectTypeOf<SettingsService['effective']>().returns.toEqualTypeOf<Promise<EffectiveSettings>>();
  });
});

describe('patched, with the Rôles the Pilote added', () => {
  it('changes a Rôle of the Pilote’s by its id, and keeps the list of their Rôles', () => {
    const custom = { id: 'r-a1b2c3d4', name: 'Revue Codex', createdAt: '2026-11-11T08:30:00.000Z' };
    const settings: AccountSettings = { ...SETTINGS, roles: { ...SETTINGS.roles, 'r-a1b2c3d4': { engine: 'codex', model: 'gpt-5.5' } }, customRoles: [custom] };
    expect(patched(settings, { roles: { 'r-a1b2c3d4': { engine: 'claude-code', model: 'claude-opus-5-5' } } })).toEqual({
      ...settings,
      roles: { ...settings.roles, 'r-a1b2c3d4': { engine: 'claude-code', model: 'claude-opus-5-5' } },
    });
  });
});

const account = (engine: 'claude-code' | 'codex', models: string[]): AiAccount => ({
  id: engine === 'codex' ? '019a6f00-0000-7000-8000-0000000000c2' : '019a6f00-0000-7000-8000-0000000000c1',
  engine,
  installed: true,
  version: '1.0.0',
  knownVersion: true,
  kind: 'subscription',
  state: 'connected',
  models: models.map((id) => ({ id, label: id, usable: true })),
  reportedAt: '2026-11-16T08:00:00.000Z',
});
const ACCOUNTS = [account('claude-code', ['claude-opus-5-5']), account('codex', ['gpt-5.5'])];
const OPUS = { engine: 'claude-code', model: 'claude-opus-5-5' } as const;
const GPT = { engine: 'codex', model: 'gpt-5.5' } as const;
const PROJECT = { id: '019a6f00-0000-7000-8000-000000000011', integrationBranch: 'develop', releaseBranch: 'main' };
const ROW = (roles: object, notificationsPush: boolean | null = null, worktreeCommands: unknown = null) => ({ roles, notificationsPush, worktreeCommands });

describe('mergeSettings', () => {
  it('inherits everything from the account without an override, nothing changed', () => {
    expect(mergeSettings(SETTINGS, NO_OVERRIDES)).toEqual({
      settings: SETTINGS,
      origins: { roles: { idea: 'compte', design: 'compte', code: 'compte', review: 'compte' }, notifications: { push: 'compte' } },
      changedCount: 0,
    });
  });

  it('takes the Projet’s Rôle over the account’s, and counts it even when equal to it', () => {
    const merged = mergeSettings(SETTINGS, { roles: { code: GPT, design: SETTINGS.roles.design! }, notifications: {} });
    expect(merged.settings.roles).toEqual({ ...SETTINGS.roles, code: GPT });
    expect(merged.origins.roles).toEqual({ idea: 'compte', design: 'projet', code: 'projet', review: 'compte' });
    expect(merged.changedCount).toBe(2);
  });

  it('ignores the override of a Rôle the account no longer has', () => {
    const merged = mergeSettings(SETTINGS, { roles: { 'r-a1b2c3d4': GPT }, notifications: {} });
    expect(merged.settings.roles).toEqual(SETTINGS.roles);
    expect(merged.origins.roles).not.toHaveProperty('r-a1b2c3d4');
    expect(merged.changedCount).toBe(0);
  });

  it('turns push off for the Projet, never on when the account’s is off', () => {
    const on = { ...SETTINGS, notifications: { push: true } };
    expect(mergeSettings(on, { roles: {}, notifications: { push: false } })).toMatchObject({ settings: { notifications: { push: false } }, origins: { notifications: { push: 'projet' } }, changedCount: 1 });
    expect(mergeSettings(on, { roles: {}, notifications: { push: true } }).settings.notifications.push).toBe(true);
    expect(mergeSettings(SETTINGS, { roles: {}, notifications: { push: true } })).toMatchObject({ settings: { notifications: { push: false } }, origins: { notifications: { push: 'projet' } } });
  });
});

describe('projectSettingsOf', () => {
  it('computes the defaults after the merge: the Review on another Moteur than the Projet’s Code', () => {
    const settings = projectSettingsOf({ ...SETTINGS, roles: { idea: null, design: null, code: null, review: null } }, ACCOUNTS, { ...PROJECT, settings: ROW({ code: GPT }) });
    expect(settings.effective.roles).toEqual({ idea: OPUS, design: OPUS, code: GPT, review: OPUS });
    expect(projectSettingsOf({ ...SETTINGS, roles: { idea: null, design: null, code: null, review: null } }, ACCOUNTS, { ...PROJECT, settings: null }).effective.roles.review).toEqual(GPT);
  });

  it('overrides a Rôle the Pilote added, and gives the branches and the sealed Commandes as stored', () => {
    const custom = { id: 'r-a1b2c3d4', name: 'Revue Codex', createdAt: '2026-11-11T08:30:00.000Z' };
    const withCustom: AccountSettings = { ...SETTINGS, roles: { ...SETTINGS.roles, 'r-a1b2c3d4': GPT }, customRoles: [custom] };
    const sealed = { key: 'k'.repeat(80), ciphertext: 'c'.repeat(40) };
    const settings = projectSettingsOf(withCustom, ACCOUNTS, { ...PROJECT, settings: ROW({ 'r-a1b2c3d4': OPUS }, false, sealed) });
    expect(settings).toMatchObject({
      projectId: PROJECT.id,
      effective: { roles: { 'r-a1b2c3d4': OPUS }, customRoles: [custom], notifications: { push: false } },
      origins: { roles: { 'r-a1b2c3d4': 'projet' }, notifications: { push: 'projet' } },
      changedCount: 2,
      branches: { integration: 'develop', release: 'main' },
      worktreeCommands: sealed,
    });
  });
});
