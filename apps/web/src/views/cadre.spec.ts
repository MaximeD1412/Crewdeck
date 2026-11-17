import { Cadre, formatHour, MenuItem, t } from '@crewdeck/sdk';
import { cadreView, type CadreState } from './cadre.js';

const empty: CadreState = { slices: {} };
const at = (path: string) => ({ path });

describe('cadreView', () => {
  it('gives the nine entries in the menu’s order, the four first ones the phone’s tabs, each valid MenuItem data', () => {
    const { menu } = cadreView(empty, at('/a-toi'));
    expect(menu.map((item) => [item.id, item.label, item.href, item.primary])).toEqual([
      ['a-toi', 'À toi', '/a-toi', true],
      ['idees', 'Idées', '/idees', true],
      ['conceptions', 'Conceptions', '/conceptions', true],
      ['boucle', 'Boucle', '/boucle', true],
      ['planning', 'Planning', '/planning', false],
      ['statistiques', 'Statistiques', '/statistiques', false],
      ['projets', 'Projets', '/projets', false],
      ['runner', 'Runner et Comptes IA', '/runner', false],
      ['parametres', 'Paramètres', '/parametres', false],
    ]);
    for (const item of menu) expect(MenuItem.data.safeParse(item).success).toBe(true);
  });

  it('gives the static metas of Planning, Statistiques and Paramètres, and no count without their slices', () => {
    const { menu } = cadreView(empty, at('/a-toi'));
    expect(Object.fromEntries(menu.map((item) => [item.id, item.meta]))).toEqual({
      'a-toi': null,
      idees: null,
      conceptions: null,
      boucle: null,
      planning: t('cadre.menu.planning.meta'),
      statistiques: t('cadre.menu.statistiques.meta'),
      projets: null,
      runner: null,
      parametres: t('cadre.menu.parametres.meta'),
    });
    expect(menu.every((item) => item.count === null)).toBe(true);
  });

  it.each([
    ['/a-toi', 'a-toi'],
    ['/idees/3f2a', 'idees'],
    ['/parametres/composants', 'parametres'],
    ['/runner', 'runner'],
    ['/nope', null],
  ] as const)('on %s marks %s as the current entry, in the Cadre and in its MenuItem', (path, current) => {
    const { cadre, menu } = cadreView(empty, at(path));
    expect(cadre.current).toBe(current);
    expect(menu.filter((item) => item.current).map((item) => item.id)).toEqual(current ? [current] : []);
  });

  it('names the page after its entry', () => {
    expect(cadreView(empty, at('/parametres/composants')).cadre.screenLabel).toBe('Paramètres');
    expect(cadreView(empty, at('/nope')).cadre.screenLabel).toBe(t('cadre.brand'));
  });

  it('without the slices of later tickets, is offline, with no detail, not live and no Pilote; valid Cadre data', () => {
    const { cadre } = cadreView(empty, at('/a-toi'));
    expect(cadre).toEqual({
      variant: 'default',
      current: 'a-toi',
      screenLabel: 'À toi',
      status: 'offline',
      statusDetail: null,
      live: false,
      pilot: null,
    });
    expect(Cadre.data.safeParse(cadre).success).toBe(true);
  });

  it.each(['connecting', 'resync'] as const)('while %s, shows the Resynchronisation status, the Actions sensibles unavailable', (connection) => {
    const { cadre } = cadreView({ connection, slices: {} }, at('/a-toi'));
    expect(cadre).toMatchObject({ status: 'resync', statusDetail: t('cadre.status.resyncDetail') });
    expect(t('cadre.status.resync')).toBe('Resynchronisation…');
    expect(Cadre.data.safeParse(cadre).success).toBe(true);
  });

  it('once live, leaves the Resynchronisation: offline until the Runner’s slice exists', () => {
    expect(cadreView({ connection: 'live', slices: {} }, at('/a-toi')).cadre).toMatchObject({ status: 'offline', statusDetail: null });
  });

  describe('the Runner’s presence', () => {
    const RUNNER = { state: 'online', lastSeenAt: '2026-11-11T13:02:00.000Z' } as const;
    const account = (engine: 'claude-code' | 'codex', connected: boolean) => ({
      engine,
      installed: true,
      kind: connected ? ('subscription' as const) : ('none' as const),
      state: connected ? ('connected' as const) : ('login-required' as const),
    });
    const accounts = (...items: ReturnType<typeof account>[]) => new Map(items.map((item) => [item.engine, item]));

    it('online, names the Moteurs connected, and is live', () => {
      const { cadre } = cadreView(
        { connection: 'live', slices: { runner: RUNNER, 'ai-account': accounts(account('claude-code', true), account('codex', true)) } },
        at('/runner'),
      );
      expect(cadre).toMatchObject({ status: 'online', statusDetail: 'Claude Code, Codex', live: true });
      expect(Cadre.data.safeParse(cadre).success).toBe(true);
    });

    it('online without a Moteur connected, has no detail', () => {
      const { cadre } = cadreView({ connection: 'live', slices: { runner: RUNNER, 'ai-account': accounts(account('codex', false)) } }, at('/a-toi'));
      expect(cadre).toMatchObject({ status: 'online', statusDetail: null, live: true });
    });

    it('offline, says since when, and is not live', () => {
      const { cadre } = cadreView({ connection: 'live', slices: { runner: { ...RUNNER, state: 'offline' } } }, at('/a-toi'));
      expect(cadre).toMatchObject({ status: 'offline', statusDetail: `depuis ${formatHour(RUNNER.lastSeenAt)}`, live: false });
    });

    it('during the Resynchronisation, shows it rather than the Runner', () => {
      const { cadre } = cadreView({ connection: 'resync', slices: { runner: RUNNER } }, at('/a-toi'));
      expect(cadre).toMatchObject({ status: 'resync', live: false });
    });
  });

  it('takes the Pilote from the pilot slice', () => {
    const state: CadreState = { slices: { pilot: { displayName: 'maximed1412', avatarUrl: 'https://avatars.example/u/1' } } };
    expect(cadreView(state, at('/a-toi')).cadre.pilot).toEqual({ displayName: 'maximed1412', avatarUrl: 'https://avatars.example/u/1' });
  });

  it('counts the open Décisions on « À toi », no count when none waits', () => {
    const open = (n: number): CadreState => ({ slices: { decision: new Map(Array.from({ length: n }, (_, i) => [String(i), {}])) } });
    const countOf = (state: CadreState) => cadreView(state, at('/idees')).menu.find((item) => item.id === 'a-toi')?.count;
    expect(countOf(open(9))).toBe(9);
    expect(countOf(open(0))).toBeNull();
    expect(cadreView(open(9), at('/a-toi')).menu.filter((item) => item.count !== null).map((item) => item.id)).toEqual(['a-toi']);
  });

  it.each(['/connexion', '/connexion/lien', '/demarrage'])('is bare on %s', (path) => {
    expect(cadreView(empty, at(path)).cadre).toMatchObject({ variant: 'bare', current: null });
  });
});
