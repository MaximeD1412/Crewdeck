import { z } from 'zod';
import { zSourceGroup, zSourceKind } from '../process/sources.js';
import { defineComposant } from './define.js';
import { zIconName } from './icons.js';
import { ProcessCanvas } from './process-canvas.js';
import { sensitive } from './sensitive.js';

/** What the panel points at: an Étape, a Phase, or the Sources (`id` the Type d'artefact a Manque names, else `null`). */
const zTarget = z.object({ kind: z.enum(['step', 'phase', 'sources']), id: z.string().min(1).nullable() });
const zTab = z.enum(['gaps', 'selection', 'sources']);
const zRow = z.object({ icon: zIconName, label: z.string().min(1), detail: z.string().nullable() });
/**
 * A row of the Sources: its value read, or, for a group (`ticket`, `code`),
 * its Select of the Sources (disabled while the other group migrates); while
 * its own group migrates, `migration` the caution badge « Local → GitHub »
 * in place of either, `detail` then saying where the migration is.
 */
const zSourceRow = zRow.extend({
  value: z.string(),
  select: z
    .object({
      group: zSourceGroup,
      label: z.string().min(1),
      value: zSourceKind,
      options: z.array(z.object({ value: zSourceKind, label: z.string().min(1) })),
      disabled: z.boolean(),
    })
    .nullable(),
  migration: z.string().nullable(),
});

type Data = z.input<typeof zData>;

const zData = z.object({
  /** `false`: no Projet of the Pilote's has this id. */
  found: z.boolean(),
  title: z.object({ projectName: z.string(), backHref: z.string(), count: z.string() }),
  /** `false` while the Projet has only its creation's draft: the banner says so. */
  hasVersion: z.boolean(),
  canvas: ProcessCanvas.data,
  tab: zTab,
  gaps: z.array(z.object({ label: z.string().min(1), meta: z.string(), target: zTarget })),
  step: z
    .object({
      name: z.string().min(1),
      kindLabel: z.string(),
      phaseName: z.string(),
      loopBack: z.string().nullable(),
      /** `from`: « ← » the Étapes that feed it, « pour chaque … », or « rien » when `fed` is `false`; `to`: « → » the Étapes it feeds, or « aucune Étape ». */
      inputs: z.array(z.object({ label: z.string(), from: z.string(), fed: z.boolean() })),
      outputs: z.array(z.object({ label: z.string(), to: z.string() })),
      tools: z.array(zRow),
    })
    .nullable(),
  phase: z.object({ name: z.string().min(1), count: z.string(), repeat: z.string() }).nullable(),
  /** `banner`: the caution Banner of a migration of Source running, shown above the Sources, and above the phone's card. */
  sources: z.object({ lead: z.string(), banner: z.object({ title: z.string().min(1), text: z.string() }).nullable(), rows: z.array(zSourceRow) }),
  footer: z.object({ changes: z.string(), versions: z.string() }),
});

// The examples: « Process Crewdeck » as the canvas's first example draws it, read only.
const crewdeck = ProcessCanvas.examples[0]!.data as Data['canvas'];
const canvas: Data['canvas'] = { ...crewdeck, editable: false, focus: null };
const withGap = ProcessCanvas.examples[1]!.data as Data['canvas'];

const OPTIONS: NonNullable<Data['sources']['rows'][number]['select']>['options'] = [
  { value: 'local', label: 'Local' },
  { value: 'github', label: 'GitHub' },
];

const SOURCES: Data['sources'] = {
  lead: 'Une Source par Type d’artefact : elle gagne toujours. Changer de Source migre tout ce qu’elle tient. GitHub : MaximeD1412/site-mairie.',
  banner: null,
  rows: [
    {
      icon: 'folder',
      label: 'Tickets',
      value: 'Local',
      detail: 'dossier tickets/ du Projet, sur atelier-pc',
      select: { group: 'ticket', label: 'Source des Tickets', value: 'local', options: OPTIONS, disabled: false },
      migration: null,
    },
    {
      icon: 'github',
      label: 'Code et documents',
      value: 'GitHub',
      detail: 'MaximeD1412/site-mairie · Changement de code, Verdict, PRD, Maquettes, Conception technique ; Inventaire non utilisé',
      select: { group: 'code', label: 'Source du code et des documents', value: 'github', options: OPTIONS, disabled: false },
      migration: null,
    },
    { icon: 'bulb', label: 'Idée', value: 'Crewdeck', detail: null, select: null, migration: null },
  ],
};

/** The Tickets migrating to GitHub, two of them finishing on Local. */
const MIGRATING: Data['sources'] = {
  ...SOURCES,
  banner: {
    title: 'Migration des Tickets vers GitHub',
    text: 'Aucun nouveau Ticket ne démarre. #12 et #14 finissent sur Local, puis les 30 Tickets passent sur GitHub d’un coup.',
  },
  rows: SOURCES.rows.map((row) =>
    row.select?.group === 'ticket'
      ? { ...row, icon: 'refresh', detail: 'migration en cours · 2 Tickets à finir sur Local', select: null, migration: 'Local → GitHub' }
      : row.select
        ? { ...row, select: { ...row.select, disabled: true } }
        : row,
  ),
};

const active: Data = {
  found: true,
  title: { projectName: 'Site mairie', backHref: '/projets', count: 'v3 active' },
  hasVersion: true,
  canvas,
  tab: 'gaps',
  gaps: [],
  step: null,
  phase: null,
  sources: SOURCES,
  footer: { changes: 'Aucun changement depuis la v3.', versions: 'v3 active depuis le 4 nov.' },
};

const REVIEW: NonNullable<Data['step']> = {
  name: 'Review',
  kindLabel: 'Agent',
  phaseName: 'Développement',
  loopBack: 'Vers « Code », tant que « Review » demande des changements, 3 fois au plus. Au-delà, une Décision t’attend.',
  inputs: [
    { label: 'Changement de code', from: '← Code', fed: true },
    { label: 'Verdict des checks', from: '← Checks', fed: true },
  ],
  outputs: [{ label: 'Verdict', to: '→ Merge' }],
  tools: [
    { icon: 'user', label: 'Rôle Review', detail: 'Claude Code · Opus 5.5' },
    { icon: 'spark', label: 'Skill review', detail: 'officielle' },
  ],
};

/**
 * « Gestion du process » (US-92, US-94, US-88, `/projets/:id/process`), read
 * at 1280 px: the PageHeader « Gestion du process » with the Projet as its
 * back link and the version or the draft as its count, a caution Banner
 * while there is no active version, then the editor filling the height: the
 * ProcessCanvas, and its panel with Tabs « Manques » (each Manque leading to
 * its block), « Étape » or « Phase » (the one selected: its Entrées and
 * Sorties, its Retour, its Outils), « Sources » (the two groups of ADR 0012
 * and the Idée), and the versions at its foot. Below 1280 px the editor is
 * not rendered (the phone's list is PROCESS-11's); a migration of Source
 * running shows there its Banner and the Sources' card. `select` comes from
 * the canvas (`centre: false`) or a Manque (`centre: true`); `view` is the
 * canvas's; `migrate`, a group's Select changed (SOURCE-7, US-102), the
 * Action sensible `source.migrate`, the Select back on its Source when the
 * Pilote cancels.
 */
export const PageProcessEditor = defineComposant({
  name: 'PageProcessEditor',
  version: 2,
  tag: 'cd-page-process-editor',
  category: 'page',
  description: 'La Gestion du process : le canevas du brouillon ou de la version active, ses Manques, l’Étape choisie et les Sources.',
  data: zData,
  actions: {
    select: z.object({ target: zTarget.nullable(), centre: z.boolean() }),
    tab: z.object({ tab: zTab }),
    view: ProcessCanvas.actions.view,
    migrate: sensitive('source.migrate', z.object({ group: zSourceGroup, to: zSourceKind })),
  },
  slots: [],
  examples: [
    { name: 'la version active, sans Manque', data: active },
    {
      name: 'un brouillon et son Manque',
      data: {
        ...active,
        title: { ...active.title, count: 'brouillon · 1 Manque' },
        canvas: { ...withGap, editable: false },
        gaps: [
          {
            label: 'Entrée « Inventaire » de « Inventaire » : rien ne l’alimente',
            meta: 'Inventaire · Idée',
            target: { kind: 'step', id: 'inventaire' },
          },
        ],
        footer: { changes: 'Brouillon en cours sur la v3.', versions: 'v3 active depuis le 4 nov.' },
      },
    },
    {
      name: 'la Review choisie',
      data: {
        ...active,
        canvas: { ...canvas, phases: canvas.phases.map((phase) => ({ ...phase, steps: phase.steps.map((step) => ({ ...step, selected: step.id === 'review' })) })) },
        tab: 'selection',
        step: REVIEW,
      },
    },
    { name: 'une Phase choisie', data: { ...active, tab: 'selection', phase: { name: 'Développement', count: '5 Étapes · 2 Retours', repeat: 'pour chaque Ticket prêt' } } },
    { name: 'les Sources', data: { ...active, tab: 'sources' } },
    { name: 'une migration de Source en cours', data: { ...active, tab: 'sources', sources: MIGRATING } },
    {
      name: 'sans version active',
      data: {
        ...active,
        title: { ...active.title, count: 'brouillon · pas encore de version active' },
        hasVersion: false,
        footer: { changes: 'Ce brouillon deviendra la v1.', versions: 'aucune version active' },
      },
    },
    { name: 'Projet introuvable', data: { ...active, found: false } },
  ],
});
