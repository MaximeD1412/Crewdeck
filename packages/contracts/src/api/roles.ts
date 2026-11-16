import { z } from 'zod';
import { ENGINE_IDS, type EngineId, MODEL_UNUSABLE_REASONS, zEngineId } from '../runner/engines.js';
import { AGENT_ROLES, type AgentRole, zAgentRole, zInstant } from '../values.js';
import { type AiAccount, isUsableAccount } from './ai-accounts.js';
import type { RoleChoice } from './settings.js';

/** A Rôle the Pilote added (PARAM-2): `r-` then 8 characters, drawn by the server. */
export const zCustomRoleId = z.string().regex(/^r-[a-z0-9]{8}$/);
export type CustomRoleId = z.infer<typeof zCustomRoleId>;

/** Any Rôle: one of the four defaults or one the Pilote added. */
export const zRoleId = z.union([zAgentRole, zCustomRoleId]);
export type RoleId = z.infer<typeof zRoleId>;

/** The Rôles a Pilote may add, at most. */
export const CUSTOM_ROLES_MAX = 20;
/** The longest name of a Rôle. */
export const ROLE_NAME_MAX = 40;

const zRoleName = z.string().trim().min(1).max(ROLE_NAME_MAX);

/** A Rôle the Pilote added: its stable id, its name (no renaming at the MVP), its creation. */
export const zCustomRole = z.object({ id: zCustomRoleId, name: zRoleName, createdAt: zInstant });
export type CustomRole = z.infer<typeof zCustomRole>;

/** `POST /api/roles`: a new Rôle, always with its own Moteur and model. */
export const zCreateRole = z.strictObject({ name: zRoleName, engine: zEngineId, model: z.string().min(1) });
export type CreateRole = z.infer<typeof zCreateRole>;

/** Why a Rôle's choice cannot run: the Moteur's reasons, then an unknown model, no Moteur at all. */
export const ROLE_CHECK_REASONS = ['no-engine', ...MODEL_UNUSABLE_REASONS, 'unknown-model'] as const;
export type RoleCheckReason = (typeof ROLE_CHECK_REASONS)[number];

/**
 * Whether a Rôle can run on the Pilote's Runner (`RolesService.check`, US-4's
 * « Un Moteur utilisable par Rôle »): its effective choice, `null` when it has
 * none (no usable model, an unknown Rôle), usable or why not.
 */
export const zRoleCheck = z.object({
  roleId: z.string().min(1),
  engine: zEngineId.nullable(),
  model: z.string().min(1).nullable(),
  usable: z.boolean(),
  reason: z.enum(ROLE_CHECK_REASONS).optional(),
});
export type RoleCheck = z.infer<typeof zRoleCheck>;

/** A model a Rôle can run on, with its Moteur and the label the Moteur reports. */
export interface UsableModel {
  readonly engine: EngineId;
  readonly model: string;
  readonly label: string;
}

/**
 * The models a Rôle can run on: the usable ones of the usable Comptes IA
 * (`isUsableAccount`), the Moteurs in the order of `ENGINE_IDS`, each one's
 * models in the order it reports them.
 */
export const usableModelsOf = (accounts: readonly AiAccount[]): UsableModel[] =>
  ENGINE_IDS.flatMap((engine) =>
    accounts
      .filter((account) => account.engine === engine && isUsableAccount(account))
      .flatMap((account) => account.models.filter((model) => model.usable).map((model) => ({ engine, model: model.id, label: model.label }))),
  );

/**
 * The Rôles in effect (PARAM-2): each default Rôle left to its default
 * (`null`) gets the first usable model, the Review the first of another
 * Moteur than the Code's effective one (the same Moteur when only one has
 * usable models). Defaults are computed, never stored; a stored choice is
 * returned as stored, even unusable now. `null` stays when no model is usable.
 * A pure function, run by the server and the page alike.
 */
export const withDefaultRoles = <R extends Readonly<Record<AgentRole, RoleChoice>>>(roles: R, accounts: readonly AiAccount[]): R => {
  const usable = usableModelsOf(accounts);
  const choice = (model: UsableModel | undefined): RoleChoice => (model ? { engine: model.engine, model: model.model } : null);
  const code = roles.code ?? choice(usable[0]);
  const defaults: Record<AgentRole, RoleChoice> = {
    idea: choice(usable[0]),
    design: choice(usable[0]),
    code,
    review: choice(usable.find((model) => model.engine !== code?.engine) ?? usable[0]),
  };
  return { ...roles, ...Object.fromEntries(AGENT_ROLES.map((role) => [role, roles[role] ?? defaults[role]])) };
};

/** Whether `choice`, a Rôle's effective one, can run on the Pilote's Comptes IA; `undefined`: the Rôle is not one of the Pilote's. */
export const checkRole = (roleId: string, choice: RoleChoice | undefined, accounts: readonly AiAccount[]): RoleCheck => {
  if (!choice) return { roleId, engine: null, model: null, usable: false, reason: 'no-engine' };
  const base = { roleId, engine: choice.engine, model: choice.model };
  const account = accounts.find((candidate) => candidate.engine === choice.engine);
  if (!account?.installed) return { ...base, usable: false, reason: 'no-engine' };
  if (account.state !== 'connected') return { ...base, usable: false, reason: 'login-required' };
  const model = account.models.find((candidate) => candidate.id === choice.model);
  if (!model) return { ...base, usable: false, reason: 'unknown-model' };
  if (!model.usable) return { ...base, usable: false, reason: model.reason ?? 'unknown-model' };
  return { ...base, usable: true };
};
