import { z } from 'zod';
import { zId } from '../values.js';
import { DecisionRow } from './decision-row.js';
import { defineComposant } from './define.js';

/** A button of a Décision: its kind's view gives it (`registerDecisionView`), `act` says which was pressed. */
export const zPageAToiAction = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  primary: z.boolean(),
  /** Why it cannot be pressed (its action needs the Runner, which is not « en ligne »), or null. */
  disabledReason: z.string().min(1).nullable(),
});

/** A row of « À toi »: a `DecisionRow`'s data, and its buttons. */
export const zPageAToiDecision = DecisionRow.data.extend({ actions: z.array(zPageAToiAction) });

const ids = (n: number) => `0193a4f2-7c1e-7a10-8b2c-00000000000${n}`;
const open = (label = 'Ouvrir', primary = false) => [{ id: 'open', label, primary, disabledReason: null }];

/** The Décisions of the mockup (`design/screens/crewdeck/a-toi.html`), as the default view shows them: no context line. */
const MOCKUP: z.input<typeof zPageAToiDecision>[] = [
  { id: ids(1), kind: 'Ticket bloqué', title: '#42 Connexion GitHub', meta: 'Crewdeck · Code · il y a 4 min', context: null, tone: 'halt', icon: 'block', actions: open() },
  { id: ids(2), kind: 'Permission demandée', title: 'Code · #44 Liste des Projets', meta: 'Crewdeck · session · il y a 2 min', context: null, tone: 'caution', icon: 'shield', actions: open() },
  { id: ids(3), kind: 'Question de l’agent', title: 'Concevoir · Agenda partagé', meta: 'Personal OS · session · il y a 3 min', context: null, tone: 'accent', icon: 'info', actions: open() },
  { id: ids(4), kind: 'Limite atteinte', title: 'Claude · fenêtre de 5 h', meta: 'Personal OS · #51 arrêté · il y a 12 min', context: null, tone: 'caution', icon: 'gauge', actions: open() },
  { id: ids(5), kind: 'Revue visuelle', title: '#38 Page Planning', meta: 'Personal OS · 4 captures · il y a 20 min', context: null, tone: 'accent', icon: 'eye', actions: open('Ouvrir', true) },
  { id: ids(6), kind: 'Conception à relire', title: 'PRD « Agenda partagé »', meta: 'Personal OS · Conception · il y a 1 h', context: null, tone: 'accent', icon: 'doc', actions: open() },
  { id: ids(7), kind: 'Ticket interrompu', title: '#47 Actualités en page d’accueil', meta: 'Site mairie · Code · il y a 2 h', context: null, tone: 'caution', icon: 'bolt', actions: open() },
  { id: ids(8), kind: 'Inventaire à approuver', title: 'Tennis Manager', meta: 'Tennis Manager · Projet existant · il y a 3 h', context: null, tone: 'accent', icon: 'folder', actions: open() },
  { id: ids(9), kind: 'Contrat incomplet', title: 'Découpage « Actualités »', meta: 'Site mairie · Tickets · hier', context: null, tone: 'caution', icon: 'contract', actions: open() },
];

const PROJECTS = [
  { id: '019a6f1e-7c3d-7e4f-9a1b-2c3d4e5f6a01', name: 'Crewdeck', count: 2 },
  { id: '019a6f1e-7c3d-7e4f-9a1b-2c3d4e5f6a02', name: 'Personal OS', count: 4 },
  { id: '019a6f1e-7c3d-7e4f-9a1b-2c3d4e5f6a03', name: 'Site mairie', count: 2 },
  { id: '019a6f1e-7c3d-7e4f-9a1b-2c3d4e5f6a04', name: 'Tennis Manager', count: 1 },
];

/**
 * « À toi » (US-17, `/a-toi`): every open Décision, newest first, under the
 * page's title and its Projet chips (« Tous les Projets », `id: null`, then
 * one per Projet, each with its count). `total` counts every open Décision,
 * the list only the selected Projet's. A row's buttons emit `act`, a click on
 * the row elsewhere `open`; a chip `filter`; « Noter une Idée », shown with
 * `canNoteIdea`, `note-idea`. Its Emplacements `loops` (« Boucles en cours »)
 * and `ai-accounts` (« Comptes IA ») stand beside the list from 1280 px,
 * below it on a phone; an empty one shows nothing.
 */
export const PageAToi = defineComposant({
  name: 'PageAToi',
  version: 1,
  tag: 'cd-page-a-toi',
  category: 'page',
  description: 'La page « À toi » : les Décisions qui attendent le Pilote, par Projet.',
  data: z.object({
    total: z.number().int().nonnegative(),
    projects: z.array(
      z.object({ id: zId.nullable(), name: z.string().min(1), count: z.number().int().nonnegative(), selected: z.boolean() }),
    ),
    decisions: z.array(zPageAToiDecision),
    canNoteIdea: z.boolean(),
  }),
  actions: {
    filter: z.object({ projectId: zId.nullable() }),
    open: z.object({ id: zId }),
    act: z.object({ id: zId, action: z.string().min(1) }),
    'note-idea': z.object({}),
  },
  slots: ['loops', 'ai-accounts'],
  examples: [
    {
      name: 'neuf Décisions',
      data: {
        total: 9,
        projects: [{ id: null, name: 'Tous les Projets', count: 9, selected: true }, ...PROJECTS.map((p) => ({ ...p, selected: false }))],
        decisions: MOCKUP,
        canNoteIdea: false,
      },
    },
    {
      name: 'un Projet choisi, avec ses Emplacements',
      data: {
        total: 9,
        projects: [
          { id: null, name: 'Tous les Projets', count: 9, selected: false },
          ...PROJECTS.map((p) => ({ ...p, selected: p.name === 'Crewdeck' })),
        ],
        decisions: MOCKUP.slice(0, 2),
        canNoteIdea: true,
      },
      slots: {
        loops: `<cd-card data='{"title":"Boucles en cours","count":1,"label":"Boucles en cours"}'>Une Boucle avance sur Personal OS.</cd-card>`,
        'ai-accounts': `<cd-card data='{"title":"Comptes IA","label":"Comptes IA"}'>Claude · 5 h : 100 %.</cd-card>`,
      },
    },
    {
      name: 'rien ne t’attend',
      data: { total: 0, projects: [{ id: null, name: 'Tous les Projets', count: 0, selected: true }], decisions: [], canNoteIdea: false },
    },
  ],
});
