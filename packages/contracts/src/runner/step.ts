import type { z } from 'zod';
import { zVerdict } from '../contrats/define.js';
import { zId } from '../values.js';
import { runnerMessage } from './envelope.js';

/**
 * Runner → server, at the end of an Étape's Session: the verdict of its
 * Contrat, checked by the Runner on the worktree and the PR (ADR 0005). Only
 * the failed rules' ids travel, never the content; the server stores it on
 * the StepRun (RUNNER-12).
 */
export const zStepVerdict = runnerMessage('step.verdict', { stepRunId: zId, verdict: zVerdict });
export type StepVerdict = z.infer<typeof zStepVerdict>;
