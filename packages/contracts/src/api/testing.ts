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

/**
 * `POST /api/testing/pilot`, outside production only: renames the Pilote
 * signed in, with its `pilot.upserted` event, as a change of the Process
 * would. The end-to-end tests make the page miss an event with it.
 */
export const zTestingPilotUpdate = z.object({ login: z.string().min(1).max(39) });
export type TestingPilotUpdate = z.infer<typeof zTestingPilotUpdate>;
