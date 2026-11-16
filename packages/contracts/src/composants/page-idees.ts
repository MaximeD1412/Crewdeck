import { z } from 'zod';
import { zId } from '../values.js';
import { defineComposant } from './define.js';
import { IdeaRow } from './idea-row.js';

/** The tabs of the Idées: to triage (in analysis, to triage, analysed), then each outcome of the triage. */
export const IDEES_TABS = ['a-trier', 'retenues', 'fusionnees', 'rejetees'] as const;
export const zIdeesTab = z.enum(IDEES_TABS);
export type IdeesTab = z.infer<typeof zIdeesTab>;

const id = (n: number) => `0193a4f2-7c1e-7a10-8c2c-0000000000${n}`;
const PROJECTS = {
  crewdeck: '019a6f1e-7c3d-7e4f-9a1b-2c3d4e5f6a01',
  personalOs: '019a6f1e-7c3d-7e4f-9a1b-2c3d4e5f6a02',
  siteMairie: '019a6f1e-7c3d-7e4f-9a1b-2c3d4e5f6a03',
  tennisManager: '019a6f1e-7c3d-7e4f-9a1b-2c3d4e5f6a04',
};

const row = (n: number, title: string, meta: string, state: 'en-analyse' | 'analysee') => ({
  id: id(n),
  title,
  meta: `#${n} · ${meta}`,
  state,
  summary: null,
  impact: null,
  effort: null,
  duplicates: null,
  selected: false,
});

/** The Idées of the mockup (`design/screens/crewdeck/idees.html`), the parts of their analysis not built yet left out. */
const MOCKUP = [
  row(64, 'Prévenir quand une Planification démarre la Boucle', 'Crewdeck · il y a 5 min', 'en-analyse'),
  row(63, 'Exporter le planning en PDF pour le client', 'Personal OS · il y a 2 h', 'analysee'),
  row(62, 'Corriger la date des actualités sur le téléphone', 'Site mairie · hier', 'analysee'),
  row(61, 'Chercher dans les recettes par ingrédient', 'Personal OS · il y a 3 j', 'analysee'),
];

const chips = (selected: string | null) => [
  { projectId: null, label: 'Tous les Projets', count: 4, selected: selected === null },
  { projectId: PROJECTS.crewdeck, label: 'Crewdeck', count: 1, selected: selected === PROJECTS.crewdeck },
  { projectId: PROJECTS.personalOs, label: 'Personal OS', count: 2, selected: selected === PROJECTS.personalOs },
  { projectId: PROJECTS.siteMairie, label: 'Site mairie', count: 1, selected: selected === PROJECTS.siteMairie },
  { projectId: PROJECTS.tennisManager, label: 'Tennis Manager', selected: selected === PROJECTS.tennisManager },
];

const tabs = (counts: readonly [number, number, number, number], selected: IdeesTab = 'a-trier') =>
  (
    [
      ['a-trier', 'À trier'],
      ['retenues', 'Retenues'],
      ['fusionnees', 'Fusionnées'],
      ['rejetees', 'Rejetées'],
    ] as const
  ).map(([tab, label], index) => ({ id: tab, label, count: counts[index] ?? 0, selected: tab === selected }));

/**
 * « Idées » (US-5, `/idees`): the page header with the count of Idées to
 * triage and « Noter une Idée » (`note`); the Projet chips (`filter`, « Tous
 * les Projets » first, `projectId: null`), each with the count of the tab's
 * Idées of its Projet; the tabs (`tab`), each with its count; then the tab's
 * Idées, newest first, in a Card titled by the tab (a row's click: `open`).
 * `empty` (no Idée at all) shows only its empty state, whose « Noter une
 * Idée » also emits `note`; an empty tab says so. `older`: on « Fusionnées »
 * and « Rejetées », whether older Idées remain on the server, beyond the 90
 * days the page holds: `available`, « Afficher les plus anciennes » under
 * the list emits `more`; `loading`, it waits. Its Emplacement `aside`
 * stands beside the list from 1280 px (an Idée's analysis, later), `list`
 * replaces the list.
 */
export const PageIdees = defineComposant({
  name: 'PageIdees',
  version: 1,
  tag: 'cd-page-idees',
  category: 'page',
  description: 'La page « Idées » : les Idées notées, à trier puis triées, par Projet.',
  data: z.object({
    toTriage: z.number().int().nonnegative(),
    empty: z.boolean(),
    projects: z.array(
      z.object({ projectId: zId.nullable(), label: z.string().min(1), count: z.number().int().positive().optional(), selected: z.boolean() }),
    ),
    tabs: z.array(z.object({ id: zIdeesTab, label: z.string().min(1), count: z.number().int().nonnegative(), selected: z.boolean() })),
    ideas: z.array(IdeaRow.data),
    older: z.enum(['none', 'available', 'loading']),
  }),
  actions: {
    note: z.object({}),
    open: z.object({ id: zId }),
    filter: z.object({ projectId: zId.nullable() }),
    tab: z.object({ tab: zIdeesTab }),
    more: z.object({}),
  },
  slots: ['list', 'aside'],
  examples: [
    {
      name: 'quatre Idées à trier',
      data: { toTriage: 4, empty: false, projects: chips(null), tabs: tabs([4, 3, 1, 2]), ideas: MOCKUP, older: 'none' },
    },
    {
      name: 'un Projet choisi',
      data: {
        toTriage: 4,
        empty: false,
        projects: chips(PROJECTS.personalOs),
        tabs: tabs([2, 1, 0, 1]),
        ideas: MOCKUP.filter((idea) => idea.meta.includes('Personal OS')),
        older: 'none',
      },
    },
    {
      name: 'un onglet vide',
      data: {
        toTriage: 0,
        empty: false,
        projects: [{ projectId: null, label: 'Tous les Projets', selected: true }],
        tabs: tabs([0, 1, 0, 0]),
        ideas: [],
        older: 'none',
      },
    },
    {
      name: 'aucune Idée',
      data: { toTriage: 0, empty: true, projects: [{ projectId: null, label: 'Tous les Projets', selected: true }], tabs: tabs([0, 0, 0, 0]), ideas: [], older: 'none' },
    },
    {
      name: 'des Idées plus anciennes',
      data: {
        toTriage: 4,
        empty: false,
        projects: [{ projectId: null, label: 'Tous les Projets', count: 1, selected: true }],
        tabs: tabs([4, 3, 1, 2], 'fusionnees'),
        ideas: [{ ...row(57, 'Envoyer le planning par e-mail', 'Personal OS · 7 nov.', 'analysee'), state: 'fusionnee' as const }],
        older: 'available',
      },
    },
  ],
});
