import { z } from 'zod';
import { type AgentRole, type OptionalStep, zEngine } from '../values.js';

/** The Moteur and the model a Rôle runs with; `null` leaves it to the default. */
export const zRoleChoice = z.object({ engine: zEngine, model: z.string().min(1) }).nullable();
export type RoleChoice = z.infer<typeof zRoleChoice>;

const zRoles = z.strictObject({ idea: zRoleChoice, design: zRoleChoice, code: zRoleChoice, review: zRoleChoice } satisfies Record<AgentRole, z.ZodType>);
const zOptionalSteps = z.strictObject({ mockups: z.boolean(), 'visual-review': z.boolean(), 'cross-review': z.boolean() } satisfies Record<OptionalStep, z.ZodType>);

/**
 * `GET /api/settings`: the Paramètres of the account, the default of each of
 * the Pilote's Projets; the `settings` slice of `GET /api/state` and the
 * payload of `settings.upserted`. The time zone is the Pilote's.
 */
export const zAccountSettings = z.object({
  roles: zRoles,
  optionalSteps: zOptionalSteps,
  notifications: z.object({ push: z.boolean() }),
  timeZone: z.string().min(1),
});
export type AccountSettings = z.infer<typeof zAccountSettings>;

/**
 * The settings in effect for a Projet: today those of the account, a Projet's
 * own overriding them once it has some.
 */
export const zEffectiveSettings = zAccountSettings;
export type EffectiveSettings = z.infer<typeof zEffectiveSettings>;

/** The settings of an account that has never changed any. */
export const DEFAULT_ACCOUNT_SETTINGS: Omit<AccountSettings, 'timeZone'> = {
  roles: { idea: null, design: null, code: null, review: null },
  optionalSteps: { mockups: true, 'visual-review': true, 'cross-review': true },
  notifications: { push: false },
};

/**
 * `PATCH /api/settings`: the fields to change, any part of them; an unknown
 * key is refused at any depth.
 */
export const zAccountSettingsPatch = z.strictObject({
  roles: zRoles.partial().optional(),
  optionalSteps: zOptionalSteps.partial().optional(),
  notifications: z.strictObject({ push: z.boolean() }).partial().optional(),
  timeZone: z.string().min(1).optional(),
});
export type AccountSettingsPatch = z.infer<typeof zAccountSettingsPatch>;
