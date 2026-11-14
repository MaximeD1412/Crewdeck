import type { AccountSettings, EffectiveSettings } from '@crewdeck/contracts';
import { isKnownTimeZone, patched, SettingsService } from './settings.service.js';

const SETTINGS: AccountSettings = {
  roles: { idea: null, design: { engine: 'codex', model: 'gpt-5' }, code: null, review: null },
  optionalSteps: { mockups: true, 'visual-review': true, 'cross-review': true },
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
  it('changes only the fields the patch gives, role by role and step by step', () => {
    expect(patched(SETTINGS, { roles: { code: { engine: 'claude-code', model: 'opus' } }, optionalSteps: { mockups: false } })).toEqual({
      ...SETTINGS,
      roles: { ...SETTINGS.roles, code: { engine: 'claude-code', model: 'opus' } },
      optionalSteps: { ...SETTINGS.optionalSteps, mockups: false },
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
