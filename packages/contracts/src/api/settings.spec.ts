import { DEFAULT_ACCOUNT_SETTINGS, zAccountSettings, zAccountSettingsPatch, zSettingsEventPayload } from '../index.js';

describe('zAccountSettings', () => {
  const settings = {
    roles: { idea: { engine: 'claude-code', model: 'opus' }, design: null, code: { engine: 'codex', model: 'gpt-5' }, review: null },
    optionalSteps: { mockups: true, 'visual-review': false, 'cross-review': true },
    notifications: { push: false },
    timeZone: 'Europe/Paris',
  };

  it('accepts the settings of an account, a role left to its default as null', () => {
    expect(zAccountSettings.parse(settings)).toEqual(settings);
    expect(zSettingsEventPayload.parse(settings)).toEqual(settings);
  });

  it('rejects an unknown engine, an empty model, a missing role', () => {
    expect(zAccountSettings.safeParse({ ...settings, roles: { ...settings.roles, idea: { engine: 'gemini', model: 'x' } } }).success).toBe(false);
    expect(zAccountSettings.safeParse({ ...settings, roles: { ...settings.roles, idea: { engine: 'codex', model: '' } } }).success).toBe(false);
    const { idea, design, code } = settings.roles;
    expect(zAccountSettings.safeParse({ ...settings, roles: { idea, design, code } }).success).toBe(false);
  });

  it('has defaults: every role null, every optional step on, push off', () => {
    expect(DEFAULT_ACCOUNT_SETTINGS).toEqual({
      roles: { idea: null, design: null, code: null, review: null },
      optionalSteps: { mockups: true, 'visual-review': true, 'cross-review': true },
      notifications: { push: false },
    });
  });
});

describe('zAccountSettingsPatch', () => {
  it('accepts any part, down to one role or one step', () => {
    expect(zAccountSettingsPatch.parse({})).toEqual({});
    expect(zAccountSettingsPatch.parse({ timeZone: 'Asia/Tokyo' })).toEqual({ timeZone: 'Asia/Tokyo' });
    expect(zAccountSettingsPatch.parse({ roles: { code: null } })).toEqual({ roles: { code: null } });
    expect(zAccountSettingsPatch.parse({ optionalSteps: { mockups: false } })).toEqual({ optionalSteps: { mockups: false } });
  });

  it('rejects an unknown key, at any depth', () => {
    expect(zAccountSettingsPatch.safeParse({ theme: 'dark' }).success).toBe(false);
    expect(zAccountSettingsPatch.safeParse({ roles: { pilot: null } }).success).toBe(false);
    expect(zAccountSettingsPatch.safeParse({ notifications: { email: true } }).success).toBe(false);
  });
});
