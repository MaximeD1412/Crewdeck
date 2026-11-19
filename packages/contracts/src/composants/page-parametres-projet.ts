import { z } from 'zod';
import { defineComposant } from './define.js';
import { placed } from './placed.js';

/**
 * The sections of a Projet's Paramètres, in their order: each an Emplacement
 * the core fills with its Card. The branches and the worktree go after the
 * Rôles, before the Planifications (BOUCLE-8's).
 */
export const PROJECT_SETTINGS_SECTIONS = ['roles', 'steps', 'branches', 'worktree', 'schedules', 'notifications'] as const;
export type ProjectSettingsSection = (typeof PROJECT_SETTINGS_SECTIONS)[number];

const ROLES = placed(
  'cd-card',
  { title: 'Rôles et modèles', label: 'Paramètres du Projet / Rôles et modèles' },
  undefined,
  placed(
    'cd-setting-row',
    { label: 'Idée', help: null, origin: 'compte' },
    undefined,
    placed('cd-select', {
      name: 'role:idea',
      label: 'Moteur et modèle du Rôle Idée',
      value: 'claude-code:claude-sonnet-5-5',
      options: [{ value: 'claude-code:claude-sonnet-5-5', label: 'Claude Code · Sonnet 5.5', disabled: false }],
      help: null,
      state: null,
    }),
  ) +
    placed(
      'cd-setting-row',
      { label: 'Code', help: null, origin: 'projet', name: 'role:code' },
      undefined,
      placed('cd-select', {
        name: 'role:code',
        label: 'Moteur et modèle du Rôle Code',
        value: 'codex:gpt-5.5',
        options: [
          { value: 'claude-code:claude-sonnet-5-5', label: 'Claude Code · Sonnet 5.5', disabled: false },
          { value: 'codex:gpt-5.5', label: 'Codex · GPT-5.5', disabled: false },
        ],
        help: null,
        state: null,
      }),
    ),
);

const NOTIFICATIONS = placed(
  'cd-card',
  { title: 'Notifications', label: 'Paramètres du Projet / Notifications' },
  undefined,
  placed(
    'cd-setting-row',
    { label: 'Notifications push', help: 'Activées ou non pour ce Projet.', origin: 'compte' },
    undefined,
    placed('cd-toggle', { name: 'push', label: 'Notifications push', checked: true, help: null, state: null }),
  ),
);

/**
 * The Paramètres of one Projet (US-82, US-39, `/projets/:id/parametres`):
 * its header (the Projet's name, the count of its settings changed, back to
 * the account's Paramètres), the Banner saying it inherits from the account,
 * the nav of its filled sections with the count each changed, then each
 * section's Card in its Emplacement, as `PageParametres` lays them out. A
 * form control of a section changing emits `change` with its `name` and its
 * value (`checked` for a Toggle).
 */
export const PageParametresProjet = defineComposant({
  name: 'PageParametresProjet',
  version: 1,
  tag: 'cd-page-parametres-projet',
  category: 'page',
  description: 'Les Paramètres d’un Projet, hérités du compte, une section par Emplacement.',
  data: z.object({
    project: z.string().min(1),
    changedCount: z.number().int().nonnegative(),
    counts: z.partialRecord(z.enum(PROJECT_SETTINGS_SECTIONS), z.number().int().nonnegative()),
  }),
  actions: { change: z.object({ name: z.string().min(1), value: z.union([z.string(), z.boolean()]) }) },
  slots: PROJECT_SETTINGS_SECTIONS,
  examples: [
    { name: 'deux sections, un Rôle modifié', data: { project: 'Site mairie', changedCount: 1, counts: { roles: 1 } }, slots: { roles: ROLES, notifications: NOTIFICATIONS } },
    { name: 'rien de modifié', data: { project: 'Crewdeck', changedCount: 0, counts: {} }, slots: { notifications: NOTIFICATIONS } },
  ],
});
