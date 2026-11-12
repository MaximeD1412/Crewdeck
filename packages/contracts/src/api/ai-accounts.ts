import { z } from 'zod';
import { ENGINE_ACCOUNT_KINDS, ENGINE_ACCOUNT_STATES, MODEL_UNUSABLE_REASONS, zEngineId } from '../runner/engines.js';
import { zId, zInstant } from '../values.js';

/** A model of a Moteur as its Runner last reported it: usable, or why not. */
export const zAiAccountModel = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  usable: z.boolean(),
  reason: z.enum(MODEL_UNUSABLE_REASONS).optional(),
});
export type AiAccountModel = z.infer<typeof zAiAccountModel>;

/**
 * A Compte IA (US-38): what one Moteur can run on the Pilote's Runner, from
 * its last `capabilities` message, one per Moteur. Its kind and state only:
 * the credential stays on the Runner (PRD, « Principles »). An item of
 * `GET /api/ai-accounts`, the payload of `ai-account.upserted`, and the
 * `ai-account` slice of `GET /api/state`.
 */
export const zAiAccount = z.object({
  id: zId,
  engine: zEngineId,
  installed: z.boolean(),
  version: z.string().min(1).nullable(),
  /** `false` outside the versions the adapter was tested on: still usable, « version non vérifiée » (risk IA-3). */
  knownVersion: z.boolean(),
  kind: z.enum(ENGINE_ACCOUNT_KINDS),
  state: z.enum(ENGINE_ACCOUNT_STATES),
  models: z.array(zAiAccountModel),
  reportedAt: zInstant,
});
export type AiAccount = z.infer<typeof zAiAccount>;

/** `GET /api/ai-accounts` (session): the Pilote's Comptes IA, one per Moteur their Runner reported, in the order of the Moteurs' ids. */
export const zAiAccountList = z.object({ items: z.array(zAiAccount) });
export type AiAccountList = z.infer<typeof zAiAccountList>;

/** A Compte IA a Rôle can run on: connected, on an installed Moteur, with at least one usable model. */
export const isUsableAccount = (account: AiAccount): boolean =>
  account.installed && account.state === 'connected' && account.models.some((model) => model.usable);
