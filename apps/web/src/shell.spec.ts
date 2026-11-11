import { Banner, Cadre, MenuItem } from '@crewdeck/sdk';
import type { ShellState } from './shell.js';
import { matchRoute } from './router.js';
import { ROUTES } from './routes.js';
import { mountShell } from './shell.js';
import { createAnnouncer } from './announcer.js';

type WithData = Element & { data: unknown };
const at = (path: string) => matchRoute(ROUTES, new URL(path, location.origin));

afterEach(() => document.body.replaceChildren());

describe('mountShell', () => {
  it('puts the Cadre in the root, its outlet inside it, for the page the router renders', () => {
    const root = document.createElement('div');
    document.body.append(root);
    const shell = mountShell({ root });
    const cadre = root.firstElementChild as WithData;
    expect(root.childElementCount).toBe(1);
    expect(cadre.localName).toBe(Cadre.tag);
    expect(shell.outlet.parentElement).toBe(cadre);
    expect(shell.outlet.hasAttribute('slot')).toBe(false);
    expect(shell.outlet.style.display).toBe('contents');
  });

  it('holds the page’s aria-live region in the Cadre, outside the page the router replaces', () => {
    const root = document.createElement('div');
    document.body.append(root);
    const announcer = createAnnouncer();
    const shell = mountShell({ root, announcer });
    const cadre = root.firstElementChild as WithData;
    const region = cadre.querySelector('[role=status]');
    expect(region).toBe(announcer.element);
    expect(region?.getAttribute('aria-live')).toBe('polite');
    expect(shell.outlet.contains(region)).toBe(false);
    announcer.announce('Action indisponible');
    announcer.announce('Action indisponible');
    expect(region?.textContent).toBe('Action indisponible');
  });

  it('on each route, sets the Cadre’s data and one cd-menu-item per entry in its menu Emplacement', () => {
    const root = document.createElement('div');
    const shell = mountShell({ root });
    const cadre = root.firstElementChild as WithData;

    shell.update(at('/parametres/composants'));
    const items = () => [...cadre.querySelectorAll<WithData>(`:scope > ${MenuItem.tag}[slot=menu]`)];
    expect(cadre.data).toMatchObject({ variant: 'default', current: 'parametres', screenLabel: 'Paramètres' });
    expect(items().map((item) => (item.data as { id: string }).id)).toEqual([
      'a-toi',
      'idees',
      'conceptions',
      'boucle',
      'planning',
      'statistiques',
      'projets',
      'runner',
      'parametres',
    ]);
    const first = items();

    shell.update(at('/idees'));
    expect(cadre.data).toMatchObject({ current: 'idees' });
    expect(items()).toEqual(first);
    expect(items().filter((item) => (item.data as { current: boolean }).current).map((item) => (item.data as { id: string }).id)).toEqual([
      'idees',
    ]);
  });

  it('reads the Pilote from the state it is given', () => {
    const root = document.createElement('div');
    const shell = mountShell({ root, state: () => ({ slices: { pilot: { login: 'maximed1412', avatarUrl: null } } }) });
    shell.update(at('/a-toi'));
    expect((root.firstElementChild as WithData).data).toMatchObject({ pilot: { login: 'maximed1412', avatarUrl: null } });
  });

  const banners = (root: HTMLElement) =>
    [...root.querySelectorAll<WithData>(`:scope > ${Cadre.tag} > ${Banner.tag}[slot=banner]`)].map((banner) => ({
      data: banner.data,
      text: banner.textContent,
    }));

  it('puts the Resynchronisation’s Banner in the banner Emplacement, the Cadre resynchronising, and takes both away on refresh once live', () => {
    const root = document.createElement('div');
    let state: ShellState = { connection: 'resync', lostAt: new Date('2026-11-11T14:12:00.000Z'), slices: {} };
    const shell = mountShell({ root, state: () => state });
    shell.update(at('/a-toi'));
    expect(banners(root)).toEqual([
      { data: { tone: 'caution', title: 'Resynchronisation…', icon: 'refresh' }, text: expect.stringMatching(/^La connexion a été perdue à \d\d:\d\d\./) },
    ]);
    expect((root.firstElementChild as WithData).data).toMatchObject({ status: 'resync' });

    state = { connection: 'live', lostAt: null, slices: {} };
    shell.refresh();
    expect(banners(root)).toEqual([]);
    expect((root.firstElementChild as WithData).data).toMatchObject({ status: 'offline', current: 'a-toi' });
  });

  it('shows an error’s message in a halt Banner until the next navigation', () => {
    const root = document.createElement('div');
    const shell = mountShell({ root, state: () => ({ connection: 'live', lostAt: null, slices: {} }) });
    shell.update(at('/a-toi'));
    shell.showError('L’état a changé depuis ton dernier affichage : vérifie avant de recommencer.');
    expect(banners(root)).toEqual([
      { data: { tone: 'halt', title: 'L’état a changé depuis ton dernier affichage : vérifie avant de recommencer.', icon: 'alert' }, text: '' },
    ]);
    shell.refresh();
    expect(banners(root)).toHaveLength(1);

    shell.update(at('/idees'));
    expect(banners(root)).toEqual([]);
  });
});
