import { z } from 'zod';
import { zId } from '../values.js';
import { CheckRow } from './check-row.js';
import { CodeBlock } from './code-block.js';
import { Banner } from './banner.js';
import { Composer } from './composer.js';
import { Button } from './button.js';
import { defineComposant } from './define.js';
import { Empty } from './empty.js';
import { zIconName } from './icons.js';
import { Message } from './message.js';
import { PermissionRequest } from './permission-request.js';
import { placed } from './placed.js';
import { Question } from './question.js';
import { ToolCall } from './tool-call.js';

const ID = '019a6f1e-7c3d-7e4f-9a1b-2c3d4e5f6a7b';
const TITLE = 'Concevoir · Agenda partagé';
const META = 'Personal OS · Conception · Claude Code';

const message = (from: 'agent' | 'pilote', text: string, at: string) => placed(Message.tag, { from, text, at });
const tool = (name: string, target: string | null, detail: string | null) =>
  placed(ToolCall.tag, { tool: name, target, detail });
const composer = (placeholder: string, state: 'idle' | 'disabled' = 'idle') =>
  placed(Composer.tag, { placeholder, hint: null, state, value: '', dictation: true });

const [questionExample] = Question.examples;
const [permissionExample] = PermissionRequest.examples;

/**
 * An agent's Session: its head (state, « Arrêter » or « Reprendre », « Fermer »),
 * its messages, tool calls, question and permission request in a log that
 * keeps to the bottom while the Pilote has not scrolled up, then its Composer.
 * `stopped`, `interrupted` and `failed` show the resume button, labelled
 * `resumeLabel` with `resumeIcon` (« Reprendre » and `play` without them):
 * « Relancer » for a failed Commande, whose output reads as a Session (US-104),
 * the core leaving its `composer` Emplacement empty.
 */
export const Session = defineComposant({
  name: 'Session',
  version: 1,
  tag: 'cd-session',
  category: 'partie',
  description: 'Une Session d’agent : ce qu’il écrit et fait, et le champ pour lui répondre.',
  data: z.object({
    id: zId,
    title: z.string(),
    meta: z.string(),
    state: z.enum(['active', 'waiting', 'stopped', 'interrupted', 'failed']),
    resumeDisabledReason: z.string().nullable(),
    resumeLabel: z.string().nullable(),
    resumeIcon: zIconName.nullable(),
  }),
  actions: { stop: z.object({}), resume: z.object({}), close: z.object({}), expand: z.object({}) },
  slots: ['default', 'composer'],
  examples: [
    {
      name: 'active',
      data: { id: ID, title: TITLE, meta: META, state: 'active', resumeDisabledReason: null, resumeLabel: null, resumeIcon: null },
      slots: {
        default: [
          tool('Read', 'docs/product/prd.md', '281 lignes'),
          tool('Read', 'CONTEXT.md', '223 lignes'),
          message(
            'agent',
            'L’Idée demande un agenda que plusieurs personnes partagent. Le PRD de Personal OS a déjà un agenda personnel : je regarde ce qu’il couvre avant de te poser mes questions.',
            '2026-11-11T14:01:00.000Z',
          ),
          tool('Grep', 'agenda · apps/web/src', '14 fichiers'),
          message('pilote', 'Pense aux événements récurrents.', '2026-11-11T14:02:00.000Z'),
          message(
            'agent',
            'Noté. L’agenda actuel a déjà les **événements récurrents** ; il manque :\n\n- qui voit un agenda partagé ;\n- qui peut modifier ses événements ;\n- ce que voit un membre qui quitte l’agenda.\n\nJe prépare les questions.',
            '2026-11-11T14:03:00.000Z',
          ),
          tool('Read', 'docs/product/features/agenda.md', '96 lignes'),
        ].join(''),
        composer: composer('Écrire à l’agent, ou dicter'),
      },
    },
    {
      name: 'en attente d’une réponse',
      data: { id: ID, title: TITLE, meta: META, state: 'waiting', resumeDisabledReason: null, resumeLabel: null, resumeIcon: null },
      slots: {
        default: [
          tool('Grep', 'agenda · apps/web/src', '14 fichiers'),
          message(
            'agent',
            'L’agenda actuel a déjà les événements récurrents. Il manque trois règles ; voici la première.',
            '2026-11-11T14:04:00.000Z',
          ),
          placed(Question.tag, questionExample?.data),
        ].join(''),
        composer: composer('Ou réponds avec tes mots'),
      },
    },
    {
      name: 'en attente d’une permission',
      data: { id: ID, title: TITLE, meta: META, state: 'waiting', resumeDisabledReason: null, resumeLabel: null, resumeIcon: null },
      slots: {
        default: [
          tool('Write', 'docs/product/features/agenda-partage.md', '142 lignes'),
          tool('Bash', 'git commit -m "docs(product) : agenda partagé"', '1 fichier'),
          message(
            'agent',
            'Le PRD est écrit. J’envoie la branche pour ouvrir la PR de Conception.',
            '2026-11-11T14:20:00.000Z',
          ),
          placed(PermissionRequest.tag, permissionExample?.data),
        ].join(''),
        composer: composer('Écrire à l’agent, ou dicter'),
      },
    },
    {
      name: 'arrêtée',
      data: { id: ID, title: TITLE, meta: META, state: 'stopped', resumeDisabledReason: null, resumeLabel: null, resumeIcon: null },
      slots: {
        default: [
          message(
            'agent',
            'Noté. L’agenda actuel a déjà les événements récurrents ; il manque qui voit un agenda partagé et qui peut modifier ses événements.',
            '2026-11-11T14:03:00.000Z',
          ),
          tool('Read', 'docs/product/features/agenda.md', '96 lignes'),
        ].join(''),
        composer: composer('Écrire pour reprendre la session'),
      },
    },
    {
      name: 'interrompue, Runner hors ligne',
      data: {
        id: ID,
        title: TITLE,
        meta: `Runner hors ligne · ${META}`,
        state: 'interrupted',
        resumeDisabledReason: 'Runner hors ligne',
        resumeLabel: null,
        resumeIcon: null,
      },
      slots: {
        default: placed(
          Empty.tag,
          { icon: 'lock', title: 'Conversation sur ton Runner' },
          undefined,
          'Elle est chiffrée de bout en bout et n’est gardée que sur ton Runner : elle s’affiche de nouveau dès qu’il est en ligne. La session est interrompue : « Reprendre » s’active quand ton Runner revient.' +
            placed(Button.tag, { label: 'Voir le Runner', variant: 'secondary', size: 'md', icon: 'server' }, 'actions'),
        ),
        composer: composer('Disponible quand ton Runner est en ligne', 'disabled'),
      },
    },
    {
      name: 'une Commande échouée',
      data: {
        id: '019a6f1e-8d4e-7f50-8b2c-3d4e5f6a7b8c',
        title: 'Lancer · Recettes',
        meta: 'Commande · 16:02',
        state: 'failed',
        resumeDisabledReason: null,
        resumeLabel: 'Relancer',
        resumeIcon: 'refresh',
      },
      slots: {
        default: [
          tool('Commande', 'docker compose up -d', '16:02'),
          placed(CodeBlock.tag, { code: 'Error response from daemon: port 8080 is already allocated' }),
          placed(CheckRow.tag, { name: 'Code de sortie', state: 'failed', detail: '1', href: null }),
          placed(Banner.tag, { tone: 'halt', title: 'Lancement échoué', icon: 'block' }, undefined, 'Une Décision t’attend dans « À toi ».'),
        ].join(''),
      },
    },
  ],
});
