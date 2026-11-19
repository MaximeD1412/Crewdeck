import { z } from 'zod';
import { zEngineId } from '../runner/engines.js';
import { AGENT_ROLES } from '../values.js';
import { zCustomRole, zCustomRoleId, zRoleId } from './roles.js';

/** The Moteur and the model a Rôle runs with; `null` leaves it to the default. An unknown key is refused. */
export const zRoleChoice = z.strictObject({ engine: zEngineId, model: z.string().min(1) }).nullable();
export type RoleChoice = z.infer<typeof zRoleChoice>;

/**
 * Each Rôle's choice: the four default ones always (`null`, their default),
 * then each Rôle of the Pilote's, by its id, with its own (never `null`). A
 * key that is no Rôle id is refused.
 */
const zRoles = z
  .object({ idea: zRoleChoice, design: zRoleChoice, code: zRoleChoice, review: zRoleChoice })
  .catchall(zRoleChoice)
  .superRefine((roles, ctx) => {
    for (const key of Object.keys(roles)) {
      if (!(AGENT_ROLES as readonly string[]).includes(key) && !zCustomRoleId.safeParse(key).success) {
        ctx.addIssue({ code: 'custom', path: [key], message: 'Rôle inconnu' });
      }
    }
  });
export type Roles = z.infer<typeof zRoles>;

/**
 * `GET /api/settings`: the Paramètres of the account, the default of each of
 * the Pilote's Projets; the `settings` slice of `GET /api/state` and the
 * payload of `settings.upserted`. The time zone is the Pilote's.
 */
export const zAccountSettings = z.object({
  roles: zRoles,
  /** The Rôles the Pilote added, by their creation. */
  customRoles: z.array(zCustomRole),
  notifications: z.object({ push: z.boolean() }),
  timeZone: z.string().min(1),
});
export type AccountSettings = z.infer<typeof zAccountSettings>;

/**
 * The settings in effect for a Projet (PARAM-3, `SettingsService.effective`):
 * the account's, the Projet's Rôles and push over them, each default Rôle
 * with its computed Moteur and model.
 */
export const zEffectiveSettings = zAccountSettings;
export type EffectiveSettings = z.infer<typeof zEffectiveSettings>;

/** The settings of an account that has never changed any. */
export const DEFAULT_ACCOUNT_SETTINGS: Omit<AccountSettings, 'timeZone'> = {
  roles: { idea: null, design: null, code: null, review: null },
  customRoles: [],
  notifications: { push: false },
};

/**
 * `PATCH /api/settings`: the fields to change, any part of them; an unknown
 * key is refused at any depth. `roles` takes any Rôle id: the server refuses
 * one that is not the Pilote's, and `null` for a Rôle of the Pilote's.
 */
export const zAccountSettingsPatch = z.strictObject({
  roles: z.partialRecord(zRoleId, zRoleChoice).optional(),
  notifications: z.strictObject({ push: z.boolean() }).partial().optional(),
  timeZone: z.string().min(1).optional(),
});
export type AccountSettingsPatch = z.infer<typeof zAccountSettingsPatch>;
