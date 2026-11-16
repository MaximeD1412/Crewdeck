import { z } from 'zod';
import { CUSTOM_ROLES_MAX, ROLE_NAME_MAX, zCustomRoleId } from '../api/roles.js';
import { zEngineId } from '../runner/engines.js';
import { defineComposant } from './define.js';

/** How many Rôles the Pilote may add and how long a name is, for a Skin to say it (it imports no `api/`). */
export { CUSTOM_ROLES_MAX, ROLE_NAME_MAX };

/** A model a Rôle can run on: its Moteur, its id, and its label as the page shows it (« Codex · GPT-5.5 »). */
const zRoleModel = z.object({ engine: zEngineId, model: z.string().min(1), label: z.string().min(1) });

const OPUS = { engine: 'claude-code', model: 'claude-opus-5-5', label: 'Claude Code · Opus 5.5' } as const;
const SONNET = { engine: 'claude-code', model: 'claude-sonnet-5-5', label: 'Claude Code · Sonnet 5.5' } as const;
const GPT = { engine: 'codex', model: 'gpt-5.5', label: 'Codex · GPT-5.5' } as const;
const CLOSED = { open: false, busy: false, nameError: null, modelError: null } as const;

const DEFAULT_ROLES = [
  { id: 'idea', name: 'Idée', help: 'Analyse chaque Idée notée.', choice: SONNET, error: null, removable: false },
  { id: 'design', name: 'Conception', help: 'PRD, maquettes et conception technique, avec toi.', choice: OPUS, error: null, removable: false },
  { id: 'code', name: 'Code', help: 'Implémente les Tickets dans la Boucle.', choice: OPUS, error: null, removable: false },
  {
    id: 'review',
    name: 'Review',
    help: 'Relit chaque changement de code. Par défaut sur un autre Moteur que le Code.',
    choice: GPT,
    error: null,
    removable: false,
  },
] as const;

const REVUE_CODEX = {
  id: 'r-k3v9q2m7',
  name: 'Revue Codex',
  help: 'Un Rôle à toi : nomme-le dans une Étape de la Gestion du process.',
  choice: GPT,
  error: null,
  removable: true,
} as const;

/**
 * The card « Rôles et modèles » of the Paramètres (PARAM-2, US-39): a
 * SettingRow per Rôle, the four default ones then the Pilote's, each with its
 * help and a Select of the usable `models` (`choose`); a stored `choice` no
 * longer among them stays selected, with the row's `error`. A Rôle the Pilote
 * added has « Retirer » (`remove`). « Ajouter un Rôle » (`add`) asks the core
 * to open the Dialog « Nouveau Rôle » (`adding.open`): a name, a model,
 * « Ajouter » (`create`, `busy` while on its way, the server's errors under
 * their field) or « Annuler » (`cancel`). Without any usable model, nothing
 * can be chosen nor added.
 */
export const RoleSettings = defineComposant({
  name: 'RoleSettings',
  version: 1,
  tag: 'cd-role-settings',
  category: 'partie',
  description: 'Les Rôles et leur modèle : un choix par Rôle, ceux que le Pilote ajoute et retire.',
  data: z.object({
    models: z.array(zRoleModel),
    roles: z.array(
      z.object({
        id: z.string().min(1),
        name: z.string().min(1),
        help: z.string().min(1),
        choice: zRoleModel.nullable(),
        error: z.string().nullable(),
        removable: z.boolean(),
      }),
    ),
    adding: z.object({ open: z.boolean(), busy: z.boolean(), nameError: z.string().nullable(), modelError: z.string().nullable() }),
  }),
  actions: {
    choose: z.object({ roleId: z.string().min(1), engine: zEngineId, model: z.string().min(1) }),
    remove: z.object({ roleId: zCustomRoleId }),
    add: z.object({}),
    create: z.object({ name: z.string().max(ROLE_NAME_MAX), engine: zEngineId, model: z.string().min(1) }),
    cancel: z.object({}),
  },
  slots: [],
  examples: [
    { name: 'tes Rôles', data: { models: [OPUS, SONNET, GPT], roles: [...DEFAULT_ROLES, REVUE_CODEX], adding: CLOSED } },
    {
      name: 'un modèle devenu inutilisable',
      data: {
        models: [OPUS, SONNET, GPT],
        roles: DEFAULT_ROLES.map((role) =>
          role.id === 'review'
            ? { ...role, choice: { engine: 'codex' as const, model: 'gpt-5.5-pro', label: 'Codex · gpt-5.5-pro' }, error: 'Quota atteint : choisis un autre modèle.' }
            : role,
        ),
        adding: CLOSED,
      },
    },
    {
      name: 'nouveau Rôle',
      data: {
        models: [OPUS, SONNET, GPT],
        roles: [...DEFAULT_ROLES],
        adding: { open: true, busy: false, nameError: 'Un Rôle porte déjà ce nom.', modelError: null },
      },
    },
    {
      name: 'aucun modèle utilisable',
      data: {
        models: [],
        roles: DEFAULT_ROLES.map((role) => ({ ...role, choice: null })),
        adding: CLOSED,
      },
    },
  ],
});
