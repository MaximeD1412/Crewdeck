import { z } from 'zod';
import { zVerdict } from '../contrats/define.js';
import { zVaultKeyVersion } from '../keys/pairing.js';
import { zSealedItem } from '../keys/sealed.js';
import { zId } from '../values.js';
import { runnerMessage } from './envelope.js';

/**
 * The messages of an agent Étape's Session (RUNNER-12), sent by the Runner
 * as its Skill calls `crewdeck-runner etape …`. A question of the Skill
 * (`etape ask`) is no message of its own: a normalised `question` in the
 * Session's stream, waiting as any other (`session.waiting`, SESSION-3).
 */

/** Runner → server: the Skill began its StepRun (`etape start`); the StepRun is `running`. */
export const zStepStarted = runnerMessage('step.started', { stepRunId: zId });
export type StepStarted = z.infer<typeof zStepStarted>;

/** The longest report's readable figures, as JSON. */
export const STEP_REPORT_FIGURES_MAX = 16_384;

/**
 * The additional data a report's `sealed` is sealed under: its StepRun's, so
 * that a ciphertext moved to another StepRun does not open. An
 * `idea-analysis` report is sealed under its Idée's own field instead,
 * `ideaItemAad(ideaId, 'analysis')` (IDEE-2), which the Idée then stores as
 * is and a rotation of the vault rewraps.
 */
export const stepReportAad = (stepRunId: string): string => `step.report:${stepRunId}`;

/**
 * Runner → server: what the Skill reported (`etape report`). `figures` are
 * what the server may read (ids, states, counts, ADR 0003's left column),
 * checked against the report schema its kind registers; `sealed` the
 * report's free text (`content`), sealed by the Runner under the vault key
 * with `stepReportAad`, which only the kind's module stores, never opens.
 */
export const zStepReport = runnerMessage('step.report', {
  stepRunId: zId,
  figures: z
    .record(z.string(), z.unknown())
    .refine((figures) => JSON.stringify(figures).length <= STEP_REPORT_FIGURES_MAX, { message: 'figures too long' }),
  sealed: zSealedItem.optional(),
  /**
   * The vault key version `sealed` is sealed under (E2E-4): a report sealed
   * under a version a rotation replaced since is kept nowhere, the Runner
   * seals it again once it holds the new one.
   */
  vaultKeyVersion: zVaultKeyVersion.optional(),
});
export type StepReport = z.infer<typeof zStepReport>;

/**
 * Runner → server, at the end of an Étape's Session: the verdict of its
 * Contrat, checked by the Runner on the worktree and the Session's change of
 * code read from the Miroir (ADR 0005). Only the failed rules' ids travel,
 * never the content; the server stores it on the StepRun (RUNNER-12).
 */
export const zStepVerdict = runnerMessage('step.verdict', { stepRunId: zId, verdict: zVerdict });
export type StepVerdict = z.infer<typeof zStepVerdict>;
