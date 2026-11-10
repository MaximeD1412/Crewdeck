import { z } from 'zod';

/**
 * `POST /api/testing/scenarios/:name`, outside production only: the scenario
 * that ran, the page it shows, and the session cookie (`<name>=<value>`) the
 * browser must carry there, `null` when it signs no Pilote in.
 */
export const zScenarioRun = z.object({
  name: z.string().min(1),
  path: z.string().startsWith('/'),
  sessionCookie: z.string().min(1).nullable(),
});
export type ScenarioRun = z.infer<typeof zScenarioRun>;
