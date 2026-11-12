import { z } from 'zod';

/**
 * The Actions sensibles (US-26, ADR 0006): what any Skin may ask but only the
 * product confirms, in its own dialog (`crewdeck-confirm`), and the server
 * checks against the `seq` the Pilote confirmed on (409
 * `sensitive-action.stale`). Starting the Boucle or a Planification covers
 * its later merges: those are not new ones.
 */
export const SENSITIVE_ACTION_IDS = [
  'merge',
  'loop.start',
  'schedule.create',
  'schedule.resume',
  'document.approve',
  'inventory.approve',
] as const;
export const zSensitiveActionId = z.enum(SENSITIVE_ACTION_IDS).meta({ title: 'SensitiveActionId' });
export type SensitiveActionId = z.infer<typeof zSensitiveActionId>;
