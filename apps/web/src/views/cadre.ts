import type { Connection } from '../store/store.js';
import { NAV_IDS, t, type Cadre, type ComposantData, type IconName, type MenuItem, type NavId } from '@crewdeck/sdk';

export type CadreData = ComposantData<typeof Cadre>;
export type MenuItemData = ComposantData<typeof MenuItem>;

/** The Pilote signed in, as the `pilot` slice holds it (`/api/me`, CORE-6). */
export interface PilotSlice {
  readonly login: string;
  readonly avatarUrl: string | null;
}

/**
 * What the Cadre reads of the store. Each slice is registered by its ticket:
 * `pilot` and the connection by CORE-6; the Runner (RUNNER-2),
 * the Décisions count (ATOI-1) and the metas of Projets and Runner
 * (PROJET-2, RUNNER-7) add theirs here.
 */
export interface CadreState {
  /** The store's connection; without it (no store), the Cadre is not resynchronising. */
  readonly connection?: Connection;
  readonly slices: {
    readonly pilot?: PilotSlice | null;
  };
}

export interface CadreView {
  readonly cadre: CadreData;
  /** One per entry, in the menu's order. */
  readonly menu: readonly MenuItemData[];
}

/** The icon of each entry (`design/components.js`, `NAV`). */
const ICONS: Readonly<Record<NavId, IconName>> = {
  'a-toi': 'inbox',
  idees: 'bulb',
  conceptions: 'pen',
  boucle: 'loop',
  planning: 'calendar',
  statistiques: 'chart',
  projets: 'folder',
  runner: 'server',
  parametres: 'settings',
};

/** The phone's tab bar: the four steps of the day; the others go to « Plus ». */
const PRIMARY: ReadonlySet<NavId> = new Set(['a-toi', 'idees', 'conceptions', 'boucle']);

/** The metas that never change; those of Projets and Runner come from their slices. */
const STATIC_META: Partial<Record<NavId, () => string>> = {
  planning: () => t('cadre.menu.planning.meta'),
  statistiques: () => t('cadre.menu.statistiques.meta'),
  parametres: () => t('cadre.menu.parametres.meta'),
};

/** The pages without the menu: only the brand above them. */
const BARE_PATHS: ReadonlySet<string> = new Set(['/connexion', '/demarrage']);

const isNavId = (value: string | undefined): value is NavId => (NAV_IDS as readonly (string | undefined)[]).includes(value);

/** The entry of a page URL: its first segment (`/idees/:id` is Idées, `/parametres/composants` Paramètres). */
const entryOf = (path: string): NavId | null => {
  const [first] = path.split('/').filter(Boolean);
  return isNavId(first) ? first : null;
};

/**
 * The Cadre's data and its menu's for the page at `route` (pure): the current
 * entry from the URL, the Pilote from the `pilot` slice, the status `resync`
 * while the connection is not `live` (ADR 0007). Until their slices exist,
 * the status is otherwise `offline` with no detail, nothing is live and no
 * entry has a count.
 */
export const cadreView = (state: CadreState, route: { readonly path: string }): CadreView => {
  const bare = BARE_PATHS.has(route.path);
  const current = bare ? null : entryOf(route.path);
  const label = (id: NavId) => t(`cadre.menu.${id}.label`);
  const resync = state.connection !== undefined && state.connection !== 'live';
  return {
    cadre: {
      variant: bare ? 'bare' : 'default',
      current,
      screenLabel: current ? label(current) : t('cadre.brand'),
      status: resync ? 'resync' : 'offline',
      statusDetail: resync ? t('cadre.status.resyncDetail') : null,
      live: false,
      pilot: state.slices.pilot ? { login: state.slices.pilot.login, avatarUrl: state.slices.pilot.avatarUrl } : null,
    },
    menu: NAV_IDS.map((id) => ({
      id,
      label: label(id),
      icon: ICONS[id],
      href: `/${id}`,
      current: id === current,
      count: null,
      meta: STATIC_META[id]?.() ?? null,
      primary: PRIMARY.has(id),
    })),
  };
};
