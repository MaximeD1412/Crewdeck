import { Banner, formatHour, t } from '@crewdeck/sdk';
import type { Device } from '@crewdeck/contracts';
import { bannersView } from './banners.js';

const TRUSTED: Device = { id: 'dev_1', name: 'Chrome sur Linux', state: 'trusted', approvedAt: '2026-11-03T09:00:00.000Z', revokedAt: null, lastSeenAt: null, current: false };
const devices = (...list: Device[]) => new Map(list.map((device) => [device.id, device]));

const LOST = new Date('2026-11-11T14:12:00.000Z');

describe('bannersView', () => {
  it('during the Resynchronisation: a caution Banner « Resynchronisation… », the time of the loss in its text', () => {
    const banners = bannersView({ connection: 'resync', lostAt: LOST }, null);
    expect(banners).toEqual([
      {
        key: 'resync',
        data: { tone: 'caution', title: 'Resynchronisation…', icon: 'refresh' },
        text: t('resync.body', { time: formatHour(LOST) }),
      },
    ]);
    expect(banners[0]?.text).toMatch(/^La connexion a été perdue à \d\d:\d\d\. Crewdeck reconstruit l’état ; /);
    expect(Banner.data.safeParse(banners[0]?.data).success).toBe(true);
  });

  it('none once live, nor at boot before any loss', () => {
    expect(bannersView({ connection: 'live', lostAt: null }, null)).toEqual([]);
    expect(bannersView({ connection: 'connecting', lostAt: null }, null)).toEqual([]);
  });

  it('an unhandled API error: a halt Banner, its message as is, after the Resynchronisation’s', () => {
    const message = 'L’état a changé depuis ton dernier affichage : vérifie avant de recommencer.';
    expect(bannersView({ connection: 'live', lostAt: null }, message)).toEqual([
      { key: 'error', data: { tone: 'halt', title: message, icon: 'alert' }, text: null },
    ]);
    expect(bannersView({ connection: 'resync', lostAt: LOST }, message).map((banner) => banner.key)).toEqual(['resync', 'error']);
  });

  it('a browser with no Appareil where another holds the vault: a caution Banner that offers to approve it', () => {
    const live = { connection: 'live', lostAt: null } as const;
    expect(bannersView({ ...live, vaultState: 'no-device', slices: { device: devices(TRUSTED) } }, null)).toEqual([
      {
        key: 'device',
        data: { tone: 'caution', title: t('devices.banner.title'), icon: 'lock' },
        text: t('devices.banner.body'),
        action: t('devices.banner.approve'),
      },
    ]);
    // A first Pilote, before « Premiers pas » made the vault: nothing to approve from.
    expect(bannersView({ ...live, vaultState: 'no-device', slices: { device: devices({ ...TRUSTED, state: 'pending' }) } }, null)).toEqual([]);
    expect(bannersView({ ...live, vaultState: 'no-device', slices: {} }, null)).toEqual([]);
    expect(bannersView({ ...live, vaultState: 'unlocked', slices: { device: devices(TRUSTED) } }, null)).toEqual([]);
    expect(bannersView({ ...live, vaultState: 'locked', slices: { device: devices(TRUSTED) } }, null)).toEqual([]);
  });
});
