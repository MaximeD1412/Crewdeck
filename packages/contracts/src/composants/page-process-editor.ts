import { z } from 'zod';
import { defineComposant } from './define.js';
import { zForEach } from '../process/definition.js';
import { zStepKind } from '../process/catalogue.js';
import { zIconName } from './icons.js';
import { Menu } from './menu.js';
import { ProcessCanvas } from './process-canvas.js';
import { sensitive } from './sensitive.js';
import { Toast } from './toast.js';

/** What the panel points at: an Étape, a Phase, or the Sources (`id` the Type d'artefact a Manque names, else `null`). */
const zTarget = z.object({ kind: z.enum(['step', 'phase', 'sources']), id: z.string().min(1).nullable() });
const zTab = z.enum(['gaps', 'selection', 'sources']);
const zRow = z.object({ icon: zIconName, label: z.string().min(1), detail: z.string().nullable() });
const zId = z.string().min(1);

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
      id: zId,
      phaseId: zId,
      name: z.string().min(1),
      kindLabel: z.string(),
      phaseName: z.string(),
      loopBack: z.string().nullable(),
      /** `from`: « ← » the Étapes that feed it, « pour chaque … », or « rien » when `fed` is `false`; `to`: « → » the Étapes it feeds, or « aucune Étape ». */
      inputs: z.array(z.object({ label: z.string(), from: z.string(), fed: z.boolean() })),
      outputs: z.array(z.object({ label: z.string(), to: z.string() })),
      tools: z.array(zRow),
      /** The Select « Phase »: every Phase, by id. */
      phases: z.array(z.object({ value: zId, label: z.string().min(1) })),
      /** Why « Retirer » is disabled, `null` while it may be removed. */
      removeReason: z.string().nullable(),
    })
    .nullable(),
  phase: z
    .object({
      id: zId,
      name: z.string().min(1),
      count: z.string(),
      /** « Répéter »: once (`null`) or for each item of a list, the one checked. */
      repeat: z.array(z.object({ forEach: zForEach.nullable(), label: z.string().min(1), checked: z.boolean() })),
      help: z.string(),
      /** Why « Retirer la Phase » is disabled, `null` while it may be removed. */
      removeReason: z.string().nullable(),
      /** Why the last name typed was refused. */
      nameError: z.string().nullable(),
      /** The page's count of the asks to focus the name: a new one focuses it (a Phase just added). */
      focusName: z.int().min(0).nullable(),
    })
    .nullable(),
  /** The catalogue's Menu, open under « Étape ». */
  catalogue: Menu.data.nullable(),
  /** The Toast over the canvas (a refusal, an activation), the core's to remove. */
  toast: Toast.data.nullable(),
  /** The Dialog asking to remove a Phase with its Étapes. */
  removePhase: z.object({ phaseId: zId, title: z.string().min(1), body: z.string().min(1) }).nullable(),
  sources: z.object({ lead: z.string(), rows: z.array(zRow.extend({ value: z.string() })) }),
  footer: z.object({ changes: z.string(), versions: z.string() }),
  /**
   * The header's « Activer la v{n+1} »: the draft's `revision` it activates
   * (`null` without a draft), and why it is disabled (`null`: it is not);
   * `null` without a Projet.
   */
  activate: z.object({ label: z.string().min(1), revision: z.int().min(1).nullable(), disabledReason: z.string().min(1).nullable() }).nullable(),
});

// The examples: « Process Crewdeck » as the canvas's first example draws it, read only.
const crewdeck = ProcessCanvas.examples[0]!.data as Data['canvas'];
const canvas: Data['canvas'] = { ...crewdeck, editable: false, focus: null };
const withGap = ProcessCanvas.examples[1]!.data as Data['canvas'];

const SOURCES: Data['sources'] = {
  lead: 'Une Source par Type d’artefact : elle gagne toujours.',
  rows: [
    { icon: 'folder', label: 'Tickets', value: 'Local', detail: 'dossier tickets/ du Projet, sur atelier-pc' },
    {
      icon: 'github',
      label: 'Code et documents',
      value: 'GitHub',
      detail: 'MaximeD1412/site-mairie · Changement de code, Verdict, PRD, Maquettes, Conception technique ; Inventaire non utilisé',
    },
    { icon: 'bulb', label: 'Idée', value: 'Crewdeck', detail: null },
  ],
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
  catalogue: null,
  toast: null,
  removePhase: null,
  sources: SOURCES,
  footer: { changes: 'Aucun changement depuis la v3.', versions: 'v3 active depuis le 4 nov.' },
  activate: { label: 'Activer la v4', revision: null, disabledReason: 'Aucun changement' },
};

const REVIEW: NonNullable<Data['step']> = {
  id: 'review',
  phaseId: 'ph-dev',
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
  phases: [
    { value: 'ph-idee', label: 'Idée' },
    { value: 'ph-conception', label: 'Conception' },
    { value: 'ph-dev', label: 'Développement' },
  ],
  removeReason: 'La Review ne se retire pas : son Rôle se change.',
};

const DEVELOPMENT: NonNullable<Data['phase']> = {
  id: 'ph-dev',
  name: 'Développement',
  count: '5 Étapes · 2 Retours',
  repeat: [
    { forEach: null, label: 'Une fois', checked: false },
    { forEach: 'idea.noted', label: 'Pour chaque Idée notée', checked: false },
    { forEach: 'idea.retained', label: 'Pour chaque Idée retenue', checked: false },
    { forEach: 'ticket.ready', label: 'Pour chaque Ticket prêt', checked: true },
  ],
  help: 'Chaque Ticket prêt parcourt la Phase : c’est la Boucle.',
  removeReason: 'Elle tient la Review et le Merge, qui ne se retirent pas.',
  nameError: null,
  focusName: null,
};

const editable: Data = { ...active, canvas: { ...canvas, editable: true } };
const withPhase = (data: Data): Data => ({
  ...data,
  canvas: { ...data.canvas, phases: data.canvas.phases.map((phase) => ({ ...phase, selected: false, target: phase.id === 'ph-dev' })) },
  tab: 'selection',
  phase: DEVELOPMENT,
});

/**
 * « Gestion du process » (US-92, US-94, US-88, `/projets/:id/process`), read
 * at 1280 px: the PageHeader « Gestion du process » with the Projet as its
 * back link and the version or the draft as its count, a caution Banner
 * while there is no active version, then the editor filling the height: the
 * ProcessCanvas, and its panel with Tabs « Manques » (each Manque leading to
 * its block), « Étape » or « Phase » (the one selected: its Entrées and
 * Sorties, its Retour, its Outils), « Sources » (the two groups of ADR 0012
 * and the Idée), and the versions at its foot. Below 1280 px the editor is
 * not rendered (the phone's list is PROCESS-11's). `select` comes from the
 * canvas (`centre: false`) or a Manque (`centre: true`); `view` is the
 * canvas's; `activate`, the header's primary, is the Action sensible
 * `process.activate` (PROCESS-10), confirmed by the core.
 *
 * Editable (US-93, US-95, PROCESS-8) while `canvas.editable`: « Phase » and
 * « Étape » in the header, the catalogue's Menu under « Étape » (the canvas's
 * `menu` Emplacement), a card dropped on a cell (`moveStep`), the Étape's
 * « Retirer » and Select « Phase », the Phase's name, « Répéter » and
 * « Retirer la Phase », the Dialog removing a Phase with its Étapes, and the
 * refusals in a Toast (the canvas's `toast` Emplacement). A disabled button
 * says why beside it.
 */
export const PageProcessEditor = defineComposant({
  name: 'PageProcessEditor',
  version: 1,
  tag: 'cd-page-process-editor',
  category: 'page',
  description: 'La Gestion du process : le canevas du brouillon ou de la version active, qu’on modifie, ses Manques, l’Étape ou la Phase choisie et les Sources.',
  data: zData,
  actions: {
    select: z.object({ target: zTarget.nullable(), centre: z.boolean() }),
    tab: z.object({ tab: zTab }),
    view: ProcessCanvas.actions.view,
    activate: sensitive('process.activate', z.object({ revision: z.int().min(1) })),
    addPhase: z.object({}),
    openCatalogue: z.object({}),
    closeMenu: z.object({}),
    addStep: z.object({ kind: zStepKind }),
    moveStep: ProcessCanvas.actions.moveStep,
    moveStepToPhase: z.object({ stepId: zId, phaseId: zId }),
    removeStep: z.object({ stepId: zId }),
    renamePhase: z.object({ phaseId: zId, name: z.string() }),
    setForEach: z.object({ phaseId: zId, forEach: zForEach.nullable() }),
    removePhase: z.object({ phaseId: zId }),
    cancelRemovePhase: z.object({}),
    confirmRemovePhase: z.object({ phaseId: zId }),
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
        footer: { changes: '1 changement depuis la v3 : Étape « Inventaire » ajoutée à « Idée ».', versions: 'v3 active depuis le 4 nov. · aucun travail en cours' },
        activate: { label: 'Activer la v4', revision: 2, disabledReason: 'Règle les Manques pour activer.' },
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
    { name: 'une Phase choisie', data: withPhase(editable) },
    {
      name: 'le catalogue ouvert',
      data: {
        ...withPhase(editable),
        catalogue: {
          title: 'Ajouter dans « Développement »',
          groups: [
            {
              label: 'Étapes du Modèle de process « Process Crewdeck »',
              items: [
                { id: 'idea-analysis', label: 'Analyse de l’Idée', icon: 'spark', detail: 'Idée → Idée', selected: false, disabled: false },
                { id: 'code', label: 'Code', icon: 'spark', detail: 'Ticket → Changement de code', selected: false, disabled: false },
              ],
            },
            {
              label: 'Revues',
              items: [
                { id: 'cross-review', label: 'Revue croisée', icon: 'spark', detail: 'un document → Verdict', selected: false, disabled: false },
                { id: 'review', label: 'Review', icon: 'spark', detail: 'sur le Rôle de ton choix → Verdict', selected: false, disabled: false },
              ],
            },
            { label: 'Sur ton Runner', items: [{ id: 'command', label: 'Commande', icon: 'terminal', detail: 'jugée sur son code de sortie', selected: false, disabled: false }] },
          ],
        },
      },
    },
    {
      name: 'un déplacement refusé',
      data: {
        ...editable,
        toast: { tone: 'halt', icon: 'block', text: 'Un Retour reste dans sa Phase : « Code » n’est pas dans « Conception »' },
      },
    },
    {
      name: 'retirer une Phase',
      data: {
        ...withPhase(editable),
        phase: { ...DEVELOPMENT, removeReason: null },
        removePhase: {
          phaseId: 'ph-dev',
          title: 'Retirer la Phase « Développement » ?',
          body: 'Ses 2 Étapes partent avec elle : Code, Revue visuelle. Le changement va dans le brouillon.',
        },
      },
    },
    { name: 'les Sources', data: { ...active, tab: 'sources' } },
    {
      name: 'sans version active',
      data: {
        ...active,
        title: { ...active.title, count: 'brouillon · première version' },
        hasVersion: false,
        footer: { changes: 'Ce brouillon deviendra la v1.', versions: 'aucune version active' },
        activate: { label: 'Activer la v1', revision: 1, disabledReason: null },
      },
    },
    { name: 'Projet introuvable', data: { ...active, found: false, activate: null } },
    {
      name: 'un brouillon à activer',
      data: {
        ...active,
        title: { ...active.title, count: 'brouillon · 3 changements' },
        footer: {
          changes:
            '3 changements depuis la v3 : Serveur MCP « Stitch » attaché à « Maquettes » ; Serveur MCP « Figma » attaché à « Maquettes » ; Retour de « Review » vers « Code » : 5 fois au plus, au lieu de 3.',
          versions: 'v3 active depuis le 4 nov. · 2 Tickets en cours finissent sur la v3 · 1 Conception en cours finit sur la v2',
        },
        activate: { label: 'Activer la v4', revision: 4, disabledReason: null },
      },
    },
    { name: 'la v4 activée', data: { ...active, title: { ...active.title, count: 'v4 active' }, toast: { tone: 'go', icon: 'check', text: 'Version 4 active.' } } },
  ],
});
