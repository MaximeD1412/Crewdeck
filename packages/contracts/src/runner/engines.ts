import { z } from 'zod';

/** The Moteurs the Runner drives (ADR 0004), one adapter each. */
export const ENGINE_IDS = ['claude-code', 'codex'] as const;
export const zEngineId = z
  .enum(ENGINE_IDS)
  // Its own Go type, `contracts.EngineId`, wherever a generated schema holds it.
  .meta({ id: 'EngineId' });
export type EngineId = z.infer<typeof zEngineId>;

export const ENGINE_ACCOUNT_KINDS = ['subscription', 'api-key', 'none'] as const;
export const ENGINE_ACCOUNT_STATES = ['connected', 'login-required'] as const;
export const MODEL_UNUSABLE_REASONS = ['login-required', 'quota-reached', 'not-in-plan'] as const;

/**
 * What a Moteur can do on this machine, as its adapter reports it: installed
 * or not, its version and whether the adapter knows it (`knownVersion` false
 * outside the ranges it was tested on, risk IA-3), the Compte IA it runs on,
 * its models (the provider's ids, the adapter's labels; `reason` when one is
 * not usable) and the features the adapter supports.
 */
export const zEngineCapabilities = z.object({
  engine: zEngineId,
  installed: z.boolean(),
  version: z.string().min(1).optional(),
  knownVersion: z.boolean(),
  account: z.object({ kind: z.enum(ENGINE_ACCOUNT_KINDS), state: z.enum(ENGINE_ACCOUNT_STATES) }),
  models: z.array(
    z.object({
      id: z.string().min(1),
      label: z.string().min(1),
      usable: z.boolean(),
      reason: z.enum(MODEL_UNUSABLE_REASONS).optional(),
    }),
  ),
  features: z.object({ interrupt: z.boolean(), resume: z.boolean(), questions: z.boolean(), permissions: z.boolean() }),
})
  // Its own Go type, `contracts.EngineCapabilities`, generated once with the
  // `capabilities` message that carries it.
  .meta({ id: 'EngineCapabilities' });
export type EngineCapabilities = z.infer<typeof zEngineCapabilities>;
