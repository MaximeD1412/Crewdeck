import { z } from 'zod';
import { zBytes } from '../keys/pairing.js';
import { zSealedItem } from '../keys/sealed.js';
import { zId, zSeq } from '../values.js';
import { zRoleId } from './roles.js';
import { zAccountSettings, zEffectiveSettings, zRoleChoice } from './settings.js';

/** The longest name of a branch a Projet takes. */
export const BRANCH_NAME_MAX = 100;

/** The message of `fields["branches.<branch>"]` for a name git would refuse. */
export const INVALID_BRANCH_NAME = 'Ce nom de branche n’est pas valide.';

// eslint-disable-next-line no-control-regex -- git refuses the control characters, as the others of this class
const FORBIDDEN = /[\u0000- \u007f~^:?*[\\]/;

/**
 * Whether `git check-ref-format --branch` takes `name`: 1..100 characters,
 * no space nor control character, none of `~^:?*[\`, no `..`, `@{` nor `//`,
 * not `@`, no leading `-` nor `/`, no trailing `/` nor `.`, no component
 * beginning with `.` or ending with `.lock`. A pure function, run by the page
 * and the server alike.
 */
export const isBranchName = (name: string): boolean =>
  name.length >= 1 &&
  name.length <= BRANCH_NAME_MAX &&
  !FORBIDDEN.test(name) &&
  !name.includes('..') &&
  !name.includes('@{') &&
  name !== '@' &&
  !name.startsWith('-') &&
  !name.endsWith('.') &&
  name.split('/').every((component) => component !== '' && !component.startsWith('.') && !component.endsWith('.lock'));

export const zBranchName = z.string().refine(isBranchName, { message: INVALID_BRANCH_NAME });

/** The longest text of one of the worktree's Commandes. */
export const WORKTREE_COMMAND_MAX = 4000;

const zWorktreeCommand = z.string().min(1).max(WORKTREE_COMMAND_MAX).nullable();

/**
 * The plaintext of a Projet's sealed `worktreeCommands` (ADR 0011, « No more
 * `.process.json` »): « Préparer le worktree », run in each Session's worktree
 * before the agent, and « Nettoyer le worktree », run when the Session ends,
 * before the worktree is removed; `null` for none. The page seals it, the
 * Runner opens it (RUNNER-20); the server never does.
 */
export const zWorktreeCommands = z.strictObject({ prepare: zWorktreeCommand, clean: zWorktreeCommand });
export type WorktreeCommands = z.infer<typeof zWorktreeCommands>;

/** The additional data the worktree Commandes of `projectId` are sealed under. */
export const worktreeCommandsAad = (projectId: string): string => `settings:${projectId}`;

/** The largest sealed `worktreeCommands` the server keeps: its ciphertext at most 16 KiB. */
export const WORKTREE_COMMANDS_SEALED_MAX = 16 * 1024;

const zSealedWorktreeCommands = z.strictObject({ key: zSealedItem.shape.key, ciphertext: zBytes(16, WORKTREE_COMMANDS_SEALED_MAX) });

/** Where a setting of a Projet comes from: inherited from the account, or changed for this Projet. */
export const zSettingOrigin = z.enum(['compte', 'projet']);
export type SettingOrigin = z.infer<typeof zSettingOrigin>;

/**
 * What a Projet changed over the account (US-82): a Rôle's Moteur and model,
 * push on or off. A key absent is inherited. The `project_settings` row.
 */
export const zProjectSettingsOverrides = z.object({
  roles: z.partialRecord(zRoleId, zRoleChoice.unwrap()),
  notifications: z.object({ push: z.boolean().optional() }),
});
export type ProjectSettingsOverrides = z.infer<typeof zProjectSettingsOverrides>;

/**
 * `GET /api/projects/:id/settings`: the Paramètres of a Projet. `effective`
 * is `SettingsService.effective` for it; `origins` says, for each Rôle of the
 * account and for push, whether it is the Projet's (a stored override, even
 * equal to the account's value); `changedCount` counts them. The branches and
 * the sealed worktree Commandes are the Projet's own (no account value),
 * never counted. An item of the `settings` slice's `projects`.
 */
export const zProjectSettings = z.object({
  projectId: zId,
  effective: zEffectiveSettings,
  origins: z.object({ roles: z.record(z.string(), zSettingOrigin), notifications: z.object({ push: zSettingOrigin }) }),
  changedCount: z.number().int().nonnegative(),
  branches: z.object({ integration: z.string().min(1), release: z.string().min(1) }),
  worktreeCommands: zSealedItem.nullable(),
});
export type ProjectSettings = z.infer<typeof zProjectSettings>;

/**
 * `PATCH /api/projects/:id/settings`'s answer: the Projet's Paramètres once
 * changed, and the `seq` of their `settings.upserted`. The page knows the
 * store holds its write once the store's `seq` reaches it, by that event or
 * by a snapshot that covers it (ADR 0007).
 */
export const zProjectSettingsUpdated = zProjectSettings.extend({ seq: zSeq });
export type ProjectSettingsUpdated = z.infer<typeof zProjectSettingsUpdated>;

/**
 * `PATCH /api/projects/:id/settings`: what to change, any part of it; an
 * unknown key is refused at any depth. A Rôle's choice, or `null` back to
 * the account; push, or `null` back to the account; a branch; the whole
 * sealed `zWorktreeCommands`, or `null` to remove both.
 */
export const zProjectSettingsPatch = z.strictObject({
  roles: z.partialRecord(zRoleId, zRoleChoice).optional(),
  notifications: z.strictObject({ push: z.boolean().nullable() }).partial().optional(),
  branches: z.strictObject({ integration: zBranchName, release: zBranchName }).partial().optional(),
  worktreeCommands: zSealedWorktreeCommands.nullable().optional(),
});
export type ProjectSettingsPatch = z.infer<typeof zProjectSettingsPatch>;

/**
 * The `settings` slice of `GET /api/state`: the account's Paramètres, and
 * those of each of the Pilote's Projets.
 */
export const zSettingsState = zAccountSettings.extend({ projects: z.array(zProjectSettings) });
export type SettingsState = z.infer<typeof zSettingsState>;
