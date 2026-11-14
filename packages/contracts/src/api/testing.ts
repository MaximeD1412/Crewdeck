import { z } from 'zod';
import { zCapabilities } from '../runner/capabilities.js';
import { zDecision, zDecisionKind } from './decisions.js';
import { zWaitingProject } from './runner-offline.js';

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

/**
 * `POST /api/testing/decisions`, outside production only: raises a Décision
 * for the Pilote signed in through `DecisionsService.raise`, as its module
 * would, with its `decision.upserted` event. No module raises one yet: the
 * end-to-end tests of « À toi » do it with this.
 */
export const zTestingDecisionRaise = zDecision.omit({ id: true, state: true, outcome: true, createdAt: true, resolvedAt: true });
export type TestingDecisionRaise = z.infer<typeof zTestingDecisionRaise>;

/** `POST /api/testing/decisions/resolve`, outside production only: resolves the open one, with its `decision.removed`. */
export const zTestingDecisionResolve = z.object({ kind: zDecisionKind, subjectId: z.string().min(1), outcome: z.string().min(1) });
export type TestingDecisionResolve = z.infer<typeof zTestingDecisionResolve>;

/**
 * `POST /api/testing/runner/capabilities`, outside production only: the
 * fake Runner of the scenario sends these Moteurs in a `capabilities`
 * message, as a Runner whose Compte IA was just connected. The end-to-end
 * tests see « Continuer » of the Comptes IA step come alive with it.
 */
export const zTestingRunnerCapabilities = z.object({ engines: zCapabilities.shape.engines });
export type TestingRunnerCapabilities = z.infer<typeof zTestingRunnerCapabilities>;

/**
 * `POST /api/testing/runner/waiting-work`, outside production only: the test
 * provider of `RunnerWaitingWork` declares these Projets for the Pilote signed
 * in, then « Runner hors ligne » is refreshed, as a module whose work starts
 * waiting would.
 */
export const zTestingWaitingWork = z.object({ projects: z.array(zWaitingProject) });
export type TestingWaitingWork = z.infer<typeof zTestingWaitingWork>;
