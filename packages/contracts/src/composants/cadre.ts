import { z } from 'zod';
import { defineComposant } from './define.js';
import { zIconName } from './icons.js';

/**
 * The entries of the Cadre's menu (`design/DESIGN.md`, « Layout »): the
 * Process's pages, fixed by the core. A Skin may restyle or reorder them,
 * never add one.
 */
export const NAV_IDS = [
  'a-toi',
  'idees',
  'conceptions',
  'boucle',
  'planning',
  'statistiques',
  'projets',
  'runner',
  'parametres',
] as const;
export const zNavId = z.enum(NAV_IDS).meta({ title: 'NavId' });
export type NavId = z.infer<typeof zNavId>;

/** What the Cadre says of the Runner: `resync` while the page rebuilds its state (CORE-6). */
export const zCadreStatus = z.enum(['online', 'offline', 'resync']).meta({ title: 'CadreStatus' });
export type CadreStatus = z.infer<typeof zCadreStatus>;

const zMenuItemData = z.object({
  id: zNavId,
  label: z.string(),
  icon: zIconName,
  href: z.string(),
  current: z.boolean(),
  count: z.number().int().nonnegative().nullable(),
  meta: z.string().nullable(),
  primary: z.boolean(),
});
type MenuItemInput = z.input<typeof zMenuItemData>;

/** The nine entries as the examples show them, `current` and the counts set by each example. */
const entries = (current: NavId | null, counts: Partial<Record<NavId, number>> = {}): MenuItemInput[] =>
  (
    [
      ['a-toi', 'À toi', 'inbox', null],
      ['idees', 'Idées', 'bulb', null],
      ['conceptions', 'Conceptions', 'pen', null],
      ['boucle', 'Boucle', 'loop', null],
      ['planning', 'Planning', 'calendar', 'Jalons et arbre des Tickets'],
      ['statistiques', 'Statistiques', 'chart', 'Délai, réussite de la Boucle, coût'],
      ['projets', 'Projets', 'folder', null],
      ['runner', 'Runner et Comptes IA', 'server', null],
      ['parametres', 'Paramètres', 'settings', 'Rôles, notifications, Planifications'],
    ] as const
  ).map(([id, label, icon, meta], index) => ({
    id,
    label,
    icon,
    href: `/${id}`,
    current: id === current,
    count: counts[id] ?? null,
    meta,
    primary: index < 4,
  }));

/** An example's `menu` Emplacement: one `cd-menu-item` per entry, its data as a JSON attribute. */
const menu = (items: readonly MenuItemInput[]): string =>
  items.map((item) => `<cd-menu-item data='${JSON.stringify(item).replaceAll("'", '&#39;')}'></cd-menu-item>`).join('');

const PAGE = '<p>Le contenu de la page.</p>';

/**
 * An entry of the Cadre's menu (US-23): a link in the sidebar at 1280, a tab
 * of the phone's tab bar when `primary`, a line with its `meta` in the
 * « Plus » sheet otherwise. The router follows its link.
 */
export const MenuItem = defineComposant({
  name: 'MenuItem',
  version: 1,
  tag: 'cd-menu-item',
  category: 'cadre',
  description: 'Une entrée du menu du Cadre.',
  data: zMenuItemData,
  actions: {},
  slots: [],
  examples: [
    {
      name: 'principale, avec son nombre',
      data: { id: 'a-toi', label: 'À toi', icon: 'inbox', href: '/a-toi', current: false, count: 9, meta: null, primary: true },
    },
    {
      name: 'courante, dans « Plus »',
      data: {
        id: 'parametres',
        label: 'Paramètres',
        icon: 'settings',
        href: '/parametres',
        current: true,
        count: null,
        meta: 'Rôles, notifications, Planifications',
        primary: false,
      },
    },
  ],
});

/**
 * The Cadre (US-23): what lays out the whole page. At 1280 a sidebar (the
 * brand, the menu, the Runner's state and the Pilote at its foot), at 390 a
 * top bar and a tab bar whose « Plus » opens the other entries in a sheet;
 * `bare` shows only the brand above the page (sign-in, getting started).
 * `openPilot` is the Pilote's avatar, which leads to `/parametres`.
 */
export const Cadre = defineComposant({
  name: 'Cadre',
  version: 2,
  tag: 'cd-cadre',
  category: 'cadre',
  description: 'Le Cadre de la page : le menu, la page, le panneau et les dialogues.',
  data: z.object({
    variant: z.enum(['default', 'bare']),
    current: zNavId.nullable(),
    screenLabel: z.string(),
    status: zCadreStatus,
    statusDetail: z.string().nullable(),
    live: z.boolean(),
    pilot: z.object({ displayName: z.string(), avatarUrl: z.string().nullable() }).nullable(),
  }),
  actions: { openPilot: z.object({}) },
  slots: ['menu', 'default', 'banner', 'panel', 'overlay'],
  examples: [
    {
      name: 'par défaut, avec les nombres',
      data: {
        variant: 'default',
        current: 'a-toi',
        screenLabel: 'À toi',
        status: 'online',
        statusDetail: 'Claude Code, Codex',
        live: true,
        pilot: { displayName: 'maximed1412', avatarUrl: null },
      },
      slots: { menu: menu(entries('a-toi', { 'a-toi': 9, idees: 4, conceptions: 2, boucle: 2 })), default: PAGE },
    },
    {
      name: 'hors ligne',
      data: {
        variant: 'default',
        current: 'planning',
        screenLabel: 'Planning',
        status: 'offline',
        statusDetail: null,
        live: false,
        pilot: { displayName: 'maximed1412', avatarUrl: null },
      },
      slots: { menu: menu(entries('planning')), default: PAGE },
    },
    {
      name: 'resynchronisation',
      data: {
        variant: 'default',
        current: 'idees',
        screenLabel: 'Idées',
        status: 'resync',
        statusDetail: 'Actions sensibles indisponibles',
        live: false,
        pilot: null,
      },
      slots: { menu: menu(entries('idees')), default: PAGE },
    },
    {
      name: 'nu',
      data: {
        variant: 'bare',
        current: null,
        screenLabel: 'Connexion',
        status: 'offline',
        statusDetail: null,
        live: false,
        pilot: null,
      },
      slots: { default: PAGE },
    },
  ],
});
