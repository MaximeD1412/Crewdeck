import { Cadre, MenuItem } from '@crewdeck/sdk';
import { matchRoute } from './router.js';
import { ROUTES } from './routes.js';
import { mountShell } from './shell.js';

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
});
