import type { Decision, Device, WaitingProject } from '@crewdeck/contracts';
import { Banner, Button, CodeBlock, formatHour, t } from '@crewdeck/sdk';
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
        action: { kind: 'button', data: { label: t('devices.banner.approve'), variant: 'primary', size: 'sm' } },
      },
    ]);
    // A first Pilote, before « Premiers pas » made the vault: nothing to approve from.
    expect(bannersView({ ...live, vaultState: 'no-device', slices: { device: devices({ ...TRUSTED, state: 'pending' }) } }, null)).toEqual([]);
    expect(bannersView({ ...live, vaultState: 'no-device', slices: {} }, null)).toEqual([]);
    expect(bannersView({ ...live, vaultState: 'unlocked', slices: { device: devices(TRUSTED) } }, null)).toEqual([]);
    expect(bannersView({ ...live, vaultState: 'locked', slices: { device: devices(TRUSTED) } }, null)).toEqual([]);
  });

  it('the last trusted Appareil revoked, the Runner linked still holds the vault: the same offer, to approve from its machine (E2E-4)', () => {
    const live = { connection: 'live', lostAt: null } as const;
    const revoked = devices({ ...TRUSTED, state: 'revoked' });
    const vault = { version: 2, rotationPending: true };
    expect(bannersView({ ...live, vaultState: 'no-device', runner: { state: 'offline' }, slices: { device: revoked, vault } }, null).map(({ key }) => key)).toEqual(['device']);
    // No vault at all (version 0), a Runner or not: nothing to approve from.
    expect(bannersView({ ...live, vaultState: 'no-device', runner: { state: 'offline' }, slices: { device: revoked, vault: { version: 0, rotationPending: false } } }, null)).toEqual([]);
    expect(bannersView({ ...live, vaultState: 'no-device', runner: { state: 'online' }, slices: {} }, null)).toEqual([]);
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
        action: { kind: 'code', data: { code: 'crewdeck-runner restart' } },
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

    it('over a Session panel while it is offline, on any page: since when it was last seen, the Sessions resume with it, « Voir le Runner »', () => {
      const SEEN = '2026-11-11T13:02:30.000Z';
      for (const path of ['/a-toi', '/idees', '/runner']) {
        const banners = bannersView({ ...live, path, session: true, runner: { state: 'offline', lastSeenAt: SEEN }, decisions: [OFFLINE] }, null);
        expect(banners).toEqual([
          {
            key: 'runner-offline',
            data: { tone: 'halt', title: 'Runner hors ligne', icon: 'server' },
            text: `Ton Runner ne répond plus depuis ${formatHour(SEEN)}. Les sessions reprendront quand il sera de nouveau en ligne. Relance-le sur ta machine.`,
            action: { kind: 'button', data: { label: 'Voir le Runner', variant: 'secondary', size: 'sm', icon: 'server' }, href: '/runner' },
          },
        ]);
      }
      expect(bannersView({ ...live, path: '/idees', session: true, runner: { state: 'online', lastSeenAt: SEEN } }, null)).toEqual([]);
      expect(bannersView({ ...live, path: '/idees', session: true, runner: null }, null)).toEqual([]);
    });

    it('after the Resynchronisation’s, before the error', () => {
      const keys = bannersView({ connection: 'resync', lostAt: LOST, path: '/runner', runner: { state: 'offline' } }, 'boom').map((banner) => banner.key);
      expect(keys).toEqual(['resync', 'runner-offline', 'error']);
    });
  });
});
