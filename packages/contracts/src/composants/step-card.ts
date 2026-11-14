import { z } from 'zod';
import { defineComposant } from './define.js';

/**
 * How an Étape's card looks: an agent's, a Pilote's gate (the compact dashed
 * card), a Commande's, or one of the product's (`core`: the checks, the merge).
 */
export const STEP_CARD_VARIANTS = ['agent', 'gate', 'command', 'core'] as const;

const json = (data: unknown) => JSON.stringify(data).replace(/'/g, '&#39;');
/** The HTML of a `cd-port`, for the examples' `ports` Emplacement. */
export const portHtml = (data: unknown) => `<cd-port data='${json(data)}'></cd-port>`;
/** The HTML of a `cd-tool-chip`, for the examples' `tools` Emplacement. */
export const toolChipHtml = (data: unknown) => `<cd-tool-chip data='${json(data)}'></cd-tool-chip>`;

/**
 * An Étape on the canvas: its name, its kind, its Entrées then its Sorties
 * (`ports`), its Outils (`tools`, « aucun Outil » when empty; a gate has
 * none), its Manques' count, and the Retour's handle when it `judges`. A
 * click or Enter emits `select`; a pointer down on the handle, `startLoopBack`.
 */
export const StepCard = defineComposant({
  name: 'StepCard',
  version: 1,
  tag: 'cd-step-card',
  category: 'partie',
  description: 'Une Étape du Process : son nom, son genre, ses Entrées et ses Sorties, ses Outils et ses Manques.',
  data: z.object({
    id: z.string().min(1),
    name: z.string(),
    kindLabel: z.string(),
    variant: z.enum(STEP_CARD_VARIANTS),
    selected: z.boolean(),
    gaps: z.int().min(0),
    judges: z.boolean(),
  }),
  actions: { select: z.object({}), startLoopBack: z.object({}) },
  slots: ['ports', 'tools'],
  examples: [
    {
      name: 'un agent',
      data: { id: 'prd', name: 'PRD', kindLabel: 'Agent', variant: 'agent', selected: false, gaps: 0, judges: false },
      slots: {
        ports: [
          portHtml({ id: 'idee', dir: 'in', type: 'idea', label: 'Idée', note: null, state: null }),
          portHtml({ id: 'prd', dir: 'out', type: 'prd', label: 'PRD', note: null, state: null }),
        ].join(''),
        tools: [toolChipHtml({ kind: 'role', label: 'Conception' }), toolChipHtml({ kind: 'skill', label: 'product-design' })].join(''),
      },
    },
    {
      name: 'une revue qui juge, choisie',
      data: { id: 'rc-prd', name: 'Revue croisée du PRD', kindLabel: 'Revue croisée', variant: 'agent', selected: true, gaps: 0, judges: true },
      slots: {
        ports: [
          portHtml({ id: 'prd', dir: 'in', type: 'prd', label: 'PRD', note: null, state: null }),
          portHtml({ id: 'verdict', dir: 'out', type: 'verdict', label: 'Verdict', note: null, state: null }),
        ].join(''),
        tools: [toolChipHtml({ kind: 'role', label: 'Review' }), toolChipHtml({ kind: 'skill', label: 'cross-review' })].join(''),
      },
    },
    {
      name: 'une porte du Pilote',
      data: { id: 'ap-prd', name: 'Approbation du PRD', kindLabel: 'Pilote', variant: 'gate', selected: false, gaps: 0, judges: true },
      slots: {
        ports: [
          portHtml({ id: 'prd', dir: 'in', type: 'prd', label: 'PRD', note: null, state: null }),
          portHtml({ id: 'verdict', dir: 'in', type: 'verdict', label: 'Verdict', note: null, state: null }),
          portHtml({ id: 'prd', dir: 'out', type: 'prd', label: 'PRD', note: null, state: null }),
        ].join(''),
      },
    },
    {
      name: 'une Étape du produit',
      data: { id: 'checks', name: 'Checks', kindLabel: 'CI du dépôt', variant: 'core', selected: false, gaps: 0, judges: false },
      slots: {
        ports: [
          portHtml({ id: 'changement', dir: 'in', type: 'code-change', label: 'Changement de code', note: null, state: null }),
          portHtml({ id: 'verdict', dir: 'out', type: 'verdict', label: 'Verdict', note: null, state: null }),
        ].join(''),
        tools: toolChipHtml({ kind: 'connector', label: 'GitHub' }),
      },
    },
    {
      name: 'avec un Manque, sans Outil',
      data: { id: 'inventaire', name: 'Inventaire', kindLabel: 'Agent', variant: 'agent', selected: false, gaps: 1, judges: false },
      slots: {
        ports: [
          portHtml({ id: 'inventaire', dir: 'in', type: 'inventory', label: 'Inventaire', note: null, state: 'unfed' }),
          portHtml({ id: 'inventaire', dir: 'out', type: 'inventory', label: 'Inventaire', note: null, state: null }),
        ].join(''),
      },
    },
    {
      name: 'une Commande',
      data: { id: 'lancer', name: 'Lancer', kindLabel: 'Commande', variant: 'command', selected: false, gaps: 0, judges: false },
      slots: {
        ports: [
          portHtml({ id: 'changement', dir: 'in', type: 'code-change', label: 'Changement de code', note: 'mergé', state: null }),
          portHtml({ id: 'livraison', dir: 'out', type: 'delivery', label: 'Livraison', note: null, state: null }),
        ].join(''),
        tools: toolChipHtml({ kind: 'command', label: 'docker compose up -d' }),
      },
    },
  ],
});
