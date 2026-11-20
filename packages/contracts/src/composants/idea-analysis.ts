import { z } from 'zod';
import { zId } from '../values.js';
import { defineComposant } from './define.js';

/**
 * Where an Idée's analysis stands as its Card shows it: `running`, its
 * Session at work (« L'analyse est en cours. »); `waiting`, the Runner
 * offline (« En attente du Runner »); `passed`, its sentences opened;
 * `failed`, its Contrat incomplete or its Session failed.
 */
export const IDEA_ANALYSIS_VIEW_STATUSES = ['running', 'waiting', 'passed', 'failed'] as const;

const ID = '0193a4f2-7c1e-7a10-8c2c-000000000063';
const PROJECTS = {
  crewdeck: '019a6f1e-7c3d-7e4f-9a1b-2c3d4e5f6a01',
  personalOs: '019a6f1e-7c3d-7e4f-9a1b-2c3d4e5f6a02',
};

const choices = (selected: string | null) => [
  { projectId: PROJECTS.crewdeck, label: 'Crewdeck', selected: selected === PROJECTS.crewdeck },
  { projectId: PROJECTS.personalOs, label: 'Personal OS', selected: selected === PROJECTS.personalOs },
  { projectId: null, label: 'nouveau', selected: selected === null },
];

const PASSED = {
  id: ID,
  title: 'Analyse',
  label: 'Une Idée / Analyse',
  heading: null,
  status: 'passed' as const,
  summary: 'Un bouton dans le planning de Personal OS qui produit la semaine affichée en PDF, prêt à envoyer au client.',
  target: { label: 'Personal OS', choices: choices(PROJECTS.personalOs) },
  impact: 'moyen : le client le demande à chaque fin de semaine',
  effort: 'faible : le planning existe déjà, seul l’export manque',
  duplicates: [],
  failure: null,
  run: 'Rôle Idée · Claude Code · il y a 2 h',
};

/**
 * The analysis of an Idée (US-6, US-48), in a Card: on its page
 * (`design/screens/crewdeck/idee.html`) and beside the list of the Idées
 * (`idees.html`, `idees-analyse-echouee.html`). Its `heading` (the Idée's
 * title, in bold, beside the list), the summary, then its facts: the Projet
 * visé with « Changer », which opens the Pilote's Projets and « nouveau »
 * (`target`, `projectId: null` for « nouveau »), the impact and the effort
 * as the view words them, and each possible duplicate as a link to its page.
 * Failed, a `halt` Banner lists the Contrat's rules not met, with
 * « Relancer l'analyse » (`reanalyse`) and « Tu peux aussi la trier sans
 * analyse : » above its Emplacement `actions` (the triage, IDEE-3). Under
 * the facts, the Rôle, the Moteur and when (`run`).
 */
export const IdeaAnalysis = defineComposant({
  name: 'IdeaAnalysis',
  version: 1,
  tag: 'cd-idea-analysis',
  category: 'partie',
  description: 'L’analyse d’une Idée : son résumé, le Projet visé à changer, son impact, son effort, ses doublons possibles, ou son échec et « Relancer l’analyse ».',
  data: z.object({
    id: zId,
    title: z.string().min(1),
    label: z.string().min(1),
    heading: z.string().nullable(),
    status: z.enum(IDEA_ANALYSIS_VIEW_STATUSES),
    summary: z.string().nullable(),
    target: z
      .object({
        label: z.string().min(1),
        choices: z.array(z.object({ projectId: zId.nullable(), label: z.string().min(1), selected: z.boolean() })).min(1),
      })
      .nullable(),
    impact: z.string().nullable(),
    effort: z.string().nullable(),
    duplicates: z.array(z.object({ id: zId, label: z.string().min(1), href: z.string().min(1) })),
    failure: z.object({ kind: z.enum(['incomplete', 'failed', 'no-engine']), rules: z.array(z.string().min(1)) }).nullable(),
    run: z.string().nullable(),
  }),
  actions: {
    target: z.object({ id: zId, projectId: zId.nullable() }),
    reanalyse: z.object({ id: zId }),
  },
  slots: ['actions'],
  examples: [
    { name: 'analysée, sur sa page', data: PASSED },
    {
      name: 'analysée, à côté de la liste',
      data: {
        ...PASSED,
        title: 'Analyse · #63',
        label: 'Idées / Analyse',
        heading: 'Exporter le planning en PDF pour le client',
        summary: 'Un bouton qui produit le planning de la semaine en PDF, à envoyer au client.',
        impact: 'moyen',
        effort: 'faible',
        duplicates: [{ id: '0193a4f2-7c1e-7a10-8c2c-000000000058', label: '#58 Imprimer le planning de la semaine', href: '/idees/0193a4f2-7c1e-7a10-8c2c-000000000058' }],
        run: null,
      },
    },
    {
      name: 'son Contrat incomplet',
      data: {
        ...PASSED,
        id: '0193a4f2-7c1e-7a10-8c2c-000000000064',
        title: 'Analyse · #64',
        label: 'Idées / Analyse',
        heading: 'Prévenir quand une Planification démarre la Boucle',
        status: 'failed',
        summary: null,
        target: null,
        impact: null,
        effort: null,
        failure: {
          kind: 'incomplete',
          rules: ['Le rapport a un titre et un résumé d’au plus 400 caractères', 'L’impact et l’effort vont de 1 à 5, chacun avec sa raison'],
        },
        run: 'Rôle Idée · Claude Code · il y a 4 min',
      },
      slots: { actions: `<cd-button data='{"label":"Rejeter","variant":"ghost","size":"sm"}'></cd-button>` },
    },
    {
      name: 'en cours',
      data: { ...PASSED, status: 'running', summary: null, target: null, impact: null, effort: null, run: 'Rôle Idée · Claude Code · il y a 1 min' },
    },
    {
      name: 'en attente du Runner',
      data: { ...PASSED, status: 'waiting', summary: null, target: null, impact: null, effort: null, run: null },
    },
  ],
});
