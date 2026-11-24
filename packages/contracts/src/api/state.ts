import { z } from 'zod';
import { zAiAccount } from './ai-accounts.js';
import { zDecision } from './decisions.js';
import { zDevice } from './devices.js';
import { zIdea } from './ideas.js';
import { zMcpServer } from './mcp-servers.js';
import { zMe } from './me.js';
import { zPhaseRun, zStepRun } from './phase-runs.js';
import { zProjectProcess } from './process.js';
import { PROCESS_TEMPLATES_MAX, zProcessTemplate } from './process-templates.js';
import { REPOSITORIES_MAX, zProject, zRepository } from './projects.js';
import { PUSH_SUBSCRIPTIONS_MAX, zPushSubscription } from './push-subscriptions.js';
import { zRunner } from './runner.js';
import { zRunnerLink } from './runner-link.js';
import { zSettingsState } from './project-settings.js';
import { zAgentSession } from './sessions.js';
import { zSourceMigration } from './source-migrations.js';
import { zCodeChange, zMilestone, zTicket } from './tickets.js';
import { zUsageAccount } from './usage.js';
import { zVaultState } from './vault.js';
import { zSeq } from '../values.js';

/**
 * The slices of `GET /api/state`, one per key the server's
 * `STATE_CONTRIBUTORS` registers: each module's ticket adds its own here, next
 * to its contributor (a test checks both lists are the same).
 */
export const STATE_SLICES = {
  pilot: zMe,
  /** The Pilote's Runner, `null` while none is linked. */
  runner: zRunner.nullable(),
  /** The Pilote's last link code (RUNNER-3), `null` before any: « Premiers pas » follows it. */
  'runner-link': zRunnerLink.nullable(),
  /** The Pilote's Comptes IA, one per Moteur their Runner reported (RUNNER-7). */
  'ai-account': z.array(zAiAccount),
  /** The Serveurs MCP the Pilote's Runner last reported, by name (RUNNER-16). */
  'mcp-server': z.array(zMcpServer),
  /** The Pilote's Appareils (E2E-2), newest first; `current` is `false`, each page sets its own. */
  devices: z.array(zDevice),
  /** The browsers that receive the Pilote's push notifications (ATOI-4), newest first, at most `PUSH_SUBSCRIPTIONS_MAX`. */
  'push-subscriptions': z.array(zPushSubscription).max(PUSH_SUBSCRIPTIONS_MAX),
  /** The vault key's version and whether a revocation waits for its rotation (E2E-4). */
  vault: zVaultState,
  /** The Pilote's Projets (PROJET-2), by name. */
  projects: z.array(zProject),
  /** The Process of each Projet (PROCESS-3): its active version and its draft, keyed by the Projet's id. */
  processes: z.array(zProjectProcess),
  /** The Pilote's Modèles de process (PROCESS-14), newest `updatedAt` first, at most `PROCESS_TEMPLATES_MAX`; « Process Crewdeck » is not one of them. */
  processTemplates: z.array(zProcessTemplate).max(PROCESS_TEMPLATES_MAX),
  /** Every unfinished PhaseRun (`running` or `waiting`) of every Projet (PROCESS-4); finished ones are read by their pages' lists. */
  phaseRuns: z.array(zPhaseRun),
  /** Every StepRun of those PhaseRuns, `superseded` ones included. */
  stepRuns: z.array(zStepRun),
  /** The Dépôts GitHub their installations reach and they do not follow yet (PROJET-2), by name, at most `REPOSITORIES_MAX`. */
  repositories: z.array(zRepository).max(REPOSITORIES_MAX),
  /** The open Décisions, every one (« À toi »). */
  decisions: z.array(zDecision),
  /** Every Idée not merged nor rejected, and those merged or rejected in the last 90 days (IDEE-1). */
  ideas: z.array(zIdea),
  /** Every open Ticket of every Projet, and those closed in the last 30 days (BOUCLE-1). */
  tickets: z.array(zTicket),
  /** The open milestones, and those closed in the last 30 days. */
  milestones: z.array(zMilestone),
  /** The open and draft changes of code, and those merged or closed in the last 30 days. */
  codeChanges: z.array(zCodeChange),
  /** The Sessions not ended, and those ended in the last 24 h (RUNNER-9). */
  sessions: z.array(zAgentSession),
  /** The Paramètres of the account. */
  settings: zSettingsState,
  /** The usage of the Pilote's Comptes IA that have one (RUNNER-13). */
  usage: z.array(zUsageAccount),
  /** The migrations of Source not `done`, and the last `done` of each group of each Projet (SOURCE-7). */
  sourceMigrations: z.array(zSourceMigration),
} as const;
export type StateKey = keyof typeof STATE_SLICES;

/**
 * `GET /api/state`: the snapshot of everything the page shows (ADR 0007),
 * read in one transaction with the `seq` it reflects; the page applies it
 * then sends `hello { lastSeq: seq }`.
 */
export const zState = z.object({ seq: zSeq, ...STATE_SLICES });
export type State = z.infer<typeof zState>;
