import { z } from 'zod';
import { zBytes32 } from '../keys/pairing.js';
import { zCapabilities } from '../runner/capabilities.js';
import { zMcpServers } from '../runner/mcp.js';
import { zLinkCode } from './runner-link.js';
import { zDecision, zDecisionKind } from './decisions.js';
import { zWaitingProject } from './runner-offline.js';
import { zId } from '../values.js';

/**
 * A trusted Appareil a scenario seeds, its keys base64url: the browser keeps
 * its private key as its own (`crewdeck-keys`) to open the vault and the
 * scenario's sealed texts. A test key, never a Pilote's.
 */
export const zScenarioDevice = z.object({
  deviceId: zId,
  privateKey: zBytes32,
  publicKey: zBytes32,
});
export type ScenarioDevice = z.infer<typeof zScenarioDevice>;

/**
 * The link code a scenario drew as the page would (the scenario `smoke`,
 * RUNNER-14): the command's `code` for `crewdeck-runner link`, and the token
 * its helpers (`/api/testing/smoke/*`) take in place of the page.
 */
export const zScenarioRunnerLink = z.object({
  code: zLinkCode,
  confirmToken: z.string().min(1),
});
export type ScenarioRunnerLink = z.infer<typeof zScenarioRunnerLink>;

/**
 * `POST /api/testing/scenarios/:name`, outside production only: the scenario
 * that ran, the page it shows, and the session cookie (`<name>=<value>`) the
 * browser must carry there, `null` when it signs no Pilote in; the link code
 * it drew, `null` when it draws none; the Appareil it trusts, `null` when
 * it seeds none.
 */
export const zScenarioRun = z.object({
  name: z.string().min(1),
  path: z.string().startsWith('/'),
  sessionCookie: z.string().min(1).nullable(),
  runnerLink: zScenarioRunnerLink.nullable(),
  device: zScenarioDevice.nullable(),
});
export type ScenarioRun = z.infer<typeof zScenarioRun>;

/**
 * `POST /api/testing/pilot`, outside production only: renames the Pilote
 * signed in, with its `pilot.upserted` event, as a change of the Process
 * would. The end-to-end tests make the page miss an event with it.
 */
export const zTestingPilotUpdate = z.object({ displayName: z.string().min(1).max(39) });
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
 * `GET /api/testing/mails?to=<address>`, outside production only: the mails
 * the fake mailer kept for that address, newest first (the sign-in links of
 * the end-to-end tests).
 */
export const zTestingMail = z.object({
  to: z.string(),
  subject: z.string(),
  text: z.string(),
  html: z.string(),
  sentAt: z.iso.datetime(),
});
export type TestingMail = z.infer<typeof zTestingMail>;
export const zTestingMails = z.object({ items: z.array(zTestingMail) });
export type TestingMails = z.infer<typeof zTestingMails>;
export const zTestingMailsQuery = z.object({ to: z.string().trim().toLowerCase() });

/**
 * `POST /api/testing/runner/mcp-servers`, outside production only: the fake
 * Runner of the scenario sends these servers in a `mcp.servers` message, as
 * a Runner on which `crewdeck-runner mcp add` or `remove` just ran. The
 * end-to-end tests of « Runner et Comptes IA » see a server arrive and leave
 * with it.
 */
export const zTestingRunnerMcpServers = z.object({ servers: zMcpServers.shape.servers });
export type TestingRunnerMcpServers = z.infer<typeof zTestingRunnerMcpServers>;

/**
 * `POST /api/testing/runner/waiting-work`, outside production only: the test
 * provider of `RunnerWaitingWork` declares these Projets for the Pilote signed
 * in, then « Runner hors ligne » is refreshed, as a module whose work starts
 * waiting would.
 */
export const zTestingWaitingWork = z.object({ projects: z.array(zWaitingProject) });
export type TestingWaitingWork = z.infer<typeof zTestingWaitingWork>;

/**
 * `POST /api/testing/smoke/confirm` and `POST /api/testing/smoke/sessions`,
 * outside production only: the page's part of the smoke test of the compiled
 * Runner (RUNNER-14), for the link the scenario `smoke` drew. `confirm`
 * confirms it once the binary sent its pairing (204; 409
 * `testing.smoke-not-pending` before); `sessions` starts a Session on the
 * scenario's Projet (201, the Session).
 */
export const zTestingSmoke = z.object({ confirmToken: z.string().min(1) });
export type TestingSmoke = z.infer<typeof zTestingSmoke>;
