import { z } from 'zod';
import { READINESS_CHECK_STATES, zProjectFolderState, zReadinessCheckId, zReadinessFixId } from '../api/projects.js';
import { zSourceKind } from '../process/sources.js';
import { zId, zInstant } from '../values.js';
import { defineComposant } from './define.js';

/** A row of the Card « Ce dont le Process a besoin »: a check of the Projet's readiness, its copy written by the page. */
const zReadinessRow = z.object({
  id: zReadinessCheckId,
  state: z.enum(READINESS_CHECK_STATES),
  title: z.string().min(1),
  meta: z.string(),
  /** « Corriger »: the fix is made where it belongs, on one click (`fix`). */
  fix: z.boolean(),
  /** Where the Pilote fixes it when the page cannot: the whole row a link. */
  href: z.string().nullable(),
});

const zData = z.object({
  id: zId,
  name: z.string().min(1),
  fullName: z.string().min(1).nullable(),
  folder: z.object({ state: zProjectFolderState, machine: z.string().nullable() }).nullable(),
  connectors: z.array(zSourceKind.exclude(['local'])),
  followedAt: zInstant,
  readiness: z.object({
    /** The PageHeader's count: « 1 point à régler », « prêt ». */
    count: z.string(),
    /** The caution Banner's text while a check is missing; `null` otherwise. */
    blocked: z.string().nullable(),
    rows: z.array(zReadinessRow),
    /** The check whose fix is running: its « Corriger » busy. */
    fixing: zReadinessCheckId.nullable(),
  }),
});
type Data = z.infer<typeof zData>;

const ok = (id: z.infer<typeof zReadinessCheckId>, title: string, meta: string, href: string | null = null): Data['readiness']['rows'][number] => ({ id, state: 'ok', title, meta, fix: false, href });

const LOCAL: Data = {
  id: '019a6f00-0000-7000-8000-000000000021',
  name: 'Recettes',
  fullName: null,
  folder: { state: 'present', machine: 'atelier-pc' },
  connectors: [],
  followedAt: '2026-11-10T09:00:00.000Z',
  readiness: {
    count: 'prêt',
    blocked: null,
    fixing: null,
    rows: [
      ok('runner-linked', 'Runner relié', 'en ligne · atelier-pc'),
      ok('folder', 'Dossier du Projet', 'sur atelier-pc · lu par le Runner'),
      ok('engines', 'Un Moteur utilisable par Rôle', 'Idée, Conception : Claude Code · Code : Codex · Review : Claude Code'),
      ok('process', 'Process', 'v1 active · aucun Manque', '/projets/019a6f00-0000-7000-8000-000000000021/process'),
    ],
  },
};

const GITHUB: Data = {
  ...LOCAL,
  id: '019a6f00-0000-7000-8000-000000000011',
  name: 'Site mairie',
  fullName: 'MaximeD1412/site-mairie',
  folder: null,
  connectors: ['github'],
  readiness: {
    count: '1 point à régler',
    blocked: 'Il manque la branche d’intégration develop. « Corriger » la crée sur GitHub en un clic ; les Tickets attendent qu’elle existe.',
    fixing: null,
    rows: [
      {
        id: 'branches',
        state: 'missing',
        title: 'Branches d’intégration et de release',
        meta: 'main présente · develop absente : « Corriger » la crée depuis main',
        fix: true,
        href: null,
      },
      ok('runner-linked', 'Runner relié', 'en ligne · atelier-pc'),
      ok('labels', 'Labels', 'labels du Process présents sur GitHub'),
    ],
  },
};

/**
 * A Projet's page (`/projets/:id`): its PageHeader (back « Projets », the
 * count of its points to fix or « prêt », « Gestion du process »
 * `openProcess`, « Paramètres du Projet » `openSettings`); the caution Banner
 * « Le Process ne peut pas démarrer » while a check is missing; the Card « Ce
 * dont le Process a besoin » (PROJET-3), a ListRow per check, « Corriger »
 * (`fix`) on one made here, its link otherwise, « ok » once met; then the Card « Projet »: its
 * Dépôt GitHub, or its folder (« sur <machine> », « en attente du Runner »
 * while `pending`, « introuvable » when `missing`; never its path, which only
 * the Runner keeps), its Connecteurs (« aucun : tout est Local » when none),
 * « Suivi depuis ». A Local Projet adds the neutral Banner « Des fichiers que
 * tu lis à la main ».
 */
export const PageProjet = defineComposant({
  name: 'PageProjet',
  version: 2,
  tag: 'cd-page-projet',
  category: 'page',
  description: 'Un Projet : ce dont son Process a besoin, son dossier ou son Dépôt GitHub, ses Connecteurs.',
  data: zData,
  actions: { openProcess: z.object({}), openSettings: z.object({}), fix: z.object({ checkId: zReadinessFixId }) },
  slots: [],
  examples: [
    { name: 'Dépôt GitHub, une branche à créer', data: GITHUB },
    { name: 'Projet local', data: LOCAL },
    { name: 'en attente du Runner', data: { ...LOCAL, folder: { state: 'pending', machine: 'atelier-pc' } } },
    { name: 'dossier introuvable', data: { ...LOCAL, folder: { state: 'missing', machine: 'atelier-pc' } } },
  ],
});
