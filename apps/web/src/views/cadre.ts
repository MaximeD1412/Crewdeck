import type { AiAccount, Runner } from '@crewdeck/contracts';
import type { Connection } from '../store/store.js';
import { formatHour, NAV_IDS, t, type Cadre, type ComposantData, type IconName, type MenuItem, type NavId } from '@crewdeck/sdk';

export type CadreData = ComposantData<typeof Cadre>;
export type MenuItemData = ComposantData<typeof MenuItem>;

/** The Pilote signed in, as the `pilot` slice holds it (`/api/me`, CORE-6). */
export interface PilotSlice {
  readonly login: string;
  readonly avatarUrl: string | null;
}

/**
 * What the Cadre reads of the store. Each slice is registered by its ticket:
 * `pilot` and the connection by CORE-6, the open Décisions by ATOI-1; the
 * Runner (RUNNER-2) and the metas of Projets and Runner
 * (PROJET-2, RUNNER-7) add theirs here.
 */
export interface CadreState {
  /** The store's connection; without it (no store), the Cadre is not resynchronising. */
  readonly connection?: Connection;
  readonly slices: {
    readonly pilot?: PilotSlice | null;
    /** The Pilote's Runner (RUNNER-2): its presence is the Cadre's status. */
    readonly runner?: Pick<Runner, 'state' | 'lastSeenAt'> | null;
    /** The Comptes IA (RUNNER-7): the Moteurs connected are the status's detail. */
    readonly 'ai-account'?: { values(): Iterable<Pick<AiAccount, 'engine' | 'installed' | 'kind' | 'state'>> };
    /** The open Décisions: « À toi » counts them. */
    readonly decision?: ReadonlyMap<string, unknown>;
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
 * The Runner's presence: online with the Moteurs connected (« Claude Code,
 * Codex »), or offline since its last heartbeat (« depuis 14:02 »); offline
 * without detail while none is linked.
 */
const runnerStatus = ({ runner, 'ai-account': accounts }: CadreState['slices']): Pick<CadreData, 'status' | 'statusDetail'> => {
  if (runner?.state !== 'online') {
    return { status: 'offline', statusDetail: runner ? t('cadre.status.offlineSince', { time: formatHour(runner.lastSeenAt) }) : null };
  }
  const connected = [...(accounts?.values() ?? [])]
    .filter(({ installed, kind, state }) => installed && state === 'connected' && kind !== 'none')
    .map(({ engine }) => t(`aiAccounts.engine.${engine}`));
  return { status: 'online', statusDetail: connected.length > 0 ? connected.join(', ') : null };
};

/**
 * The Cadre's data and its menu's for the page at `route` (pure): the current
 * entry from the URL, the Pilote from the `pilot` slice, the status `resync`
 * while the connection is not `live` (ADR 0007), else the Runner's presence,
 * « En direct » while it is online; the count of « À toi » the open Décisions
 * (none at 0). Until their slices exist, the status is `offline` with no
 * detail and no entry has a count.
 */
export const cadreView = (state: CadreState, route: { readonly path: string }): CadreView => {
  const bare = BARE_PATHS.has(route.path);
  const current = bare ? null : entryOf(route.path);
  const label = (id: NavId) => t(`cadre.menu.${id}.label`);
  const resync = state.connection !== undefined && state.connection !== 'live';
  const { status, statusDetail } = resync
    ? { status: 'resync' as const, statusDetail: t('cadre.status.resyncDetail') }
    : runnerStatus(state.slices);
  return {
    cadre: {
      variant: bare ? 'bare' : 'default',
      current,
      screenLabel: current ? label(current) : t('cadre.brand'),
      status,
      statusDetail,
      live: status === 'online',
      pilot: state.slices.pilot ? { login: state.slices.pilot.login, avatarUrl: state.slices.pilot.avatarUrl } : null,
    },
    menu: NAV_IDS.map((id) => ({
      id,
      label: label(id),
      icon: ICONS[id],
      href: `/${id}`,
      current: id === current,
      count: id === 'a-toi' && state.slices.decision?.size ? state.slices.decision.size : null,
      meta: STATIC_META[id]?.() ?? null,
      primary: PRIMARY.has(id),
    })),
  };
};
