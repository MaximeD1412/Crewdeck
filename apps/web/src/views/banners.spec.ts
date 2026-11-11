import { Banner, formatHour, t } from '@crewdeck/sdk';
import { bannersView } from './banners.js';

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
});
