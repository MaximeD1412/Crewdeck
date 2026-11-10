import { z } from 'zod';

/** The name of the event a Composant dispatches for each of its actions (ADR 0006). */
export const CD_ACTION = 'cd-action';

/** The `detail` of a `cd-action` event; `payload` is checked against the action's schema by the core. */
export const zCdActionDetail = z.object({
  composant: z.string(),
  action: z.string(),
  payload: z.unknown(),
});
export type CdActionDetail = z.infer<typeof zCdActionDetail>;
