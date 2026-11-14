import type { Decision, WaitingProject } from '@crewdeck/contracts';
import { Banner, Button, CodeBlock, formatHour, t } from '@crewdeck/sdk';
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

  describe('« Runner hors ligne »', () => {
    const SINCE = '2026-11-11T13:02:00.000Z';
    const PROJECTS: WaitingProject[] = [
      { projectId: '019a6f1e-7c3d-7e4f-9a1b-2c3d4e5f6a01', name: 'Crewdeck', items: [{ kind: 'ticket-in-progress', number: 44 }] },
      {
        projectId: '019a6f1e-7c3d-7e4f-9a1b-2c3d4e5f6a02',
        name: 'Personal OS',
        items: [
          { kind: 'ticket-in-progress', number: 53 },
          { kind: 'tickets-ready', count: 2 },
        ],
      },
      { projectId: '019a6f1e-7c3d-7e4f-9a1b-2c3d4e5f6a03', name: 'Site mairie', items: [{ kind: 'ticket-interrupted', number: 47 }] },
    ];
    const OFFLINE = { kind: 'runner-offline', params: { since: SINCE, projects: JSON.stringify(PROJECTS) }, createdAt: SINCE } as unknown as Decision;
    const OTHER = { kind: 'ticket-blocked', params: {}, createdAt: SINCE } as unknown as Decision;
    const live = { connection: 'live', lostAt: null } as const;

    it('on /a-toi while its Décision is open: halt, since when, what waits in each Projet, « Voir le Runner » to /runner', () => {
      const [banner, ...others] = bannersView({ ...live, path: '/a-toi', runner: { state: 'offline' }, decisions: [OTHER, OFFLINE] }, null);
      expect(others).toEqual([]);
      expect(banner).toEqual({
        key: 'runner-offline',
        data: { tone: 'halt', title: 'Runner hors ligne', icon: 'server' },
        text: `Ton Runner ne répond plus depuis ${formatHour(SINCE)}. Le travail attend dans 3 Projets : Crewdeck (#44 en cours), Personal OS (#53 en cours, 2 Tickets prêts), Site mairie (#47 interrompu). Relance-le sur ta machine.`,
        action: { kind: 'button', data: { label: 'Voir le Runner', variant: 'secondary', size: 'sm', icon: 'server' }, href: '/runner' },
      });
      expect(Banner.data.safeParse(banner?.data).success).toBe(true);
      expect(banner?.action?.kind === 'button' && Button.data.safeParse(banner.action.data).success).toBe(true);
    });

    it('none on /a-toi without the Décision (nothing waits, or the Runner back online), nor on another page', () => {
      expect(bannersView({ ...live, path: '/a-toi', runner: { state: 'offline' }, decisions: [OTHER] }, null)).toEqual([]);
      expect(bannersView({ ...live, path: '/idees', runner: { state: 'offline' }, decisions: [OFFLINE] }, null)).toEqual([]);
      expect(bannersView({ ...live, path: '/a-toi', decisions: [OFFLINE] }, null).map((banner) => banner.key)).toEqual(['runner-offline']);
    });

    it('on /runner while it is offline: « Rien ne tourne » with the Projets that wait, and the restart command', () => {
      const [banner] = bannersView({ ...live, path: '/runner', runner: { state: 'offline' }, decisions: [OFFLINE] }, null);
      expect(banner).toEqual({
        key: 'runner-offline',
        data: { tone: 'halt', title: 'Runner hors ligne', icon: 'server' },
        text: 'Rien ne tourne : le travail attend dans Crewdeck, Personal OS et Site mairie. Relance le Runner sur ta machine.',
        action: { kind: 'code', data: { code: 'crewdeck-runner start' } },
      });
      expect(banner?.action?.kind === 'code' && CodeBlock.data.safeParse(banner.action.data).success).toBe(true);
    });

    it('on /runner with nothing waiting: « Aucun travail n’attend »; none online or without a Runner', () => {
      expect(bannersView({ ...live, path: '/runner', runner: { state: 'offline' }, decisions: [] }, null)[0]?.text).toBe(
        'Rien ne tourne. Aucun travail n’attend. Relance le Runner sur ta machine.',
      );
      expect(bannersView({ ...live, path: '/runner', runner: { state: 'online' }, decisions: [OFFLINE] }, null)).toEqual([]);
      expect(bannersView({ ...live, path: '/runner', runner: null }, null)).toEqual([]);
    });

    it('after the Resynchronisation’s, before the error', () => {
      const keys = bannersView({ connection: 'resync', lostAt: LOST, path: '/runner', runner: { state: 'offline' } }, 'boom').map((banner) => banner.key);
      expect(keys).toEqual(['resync', 'runner-offline', 'error']);
    });
  });
});
