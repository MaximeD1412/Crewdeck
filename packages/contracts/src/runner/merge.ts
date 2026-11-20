import { z } from 'zod';
import { zSourceNumber } from '../api/tickets.js';
import { zSha } from '../github/index.js';
import { zId } from '../values.js';
import { runnerMessage } from './envelope.js';

/**
 * The merge of a local change of code (SOURCE-5, ADR 0012, « The Local
 * folder »), bound to the SHA every Verdict judged (ADR 0002): the Runner
 * squashes the change in its clone on the folder's integration head, then
 * fast-forwards the folder, never touching the Pilote's uncommitted work.
 * Nothing of a file, a branch or a title here (ADR 0003): the files git
 * names when it refuses stay on the Runner.
 *
 * - server → Runner: `merge.local`;
 * - Runner → server: `merge.local.result`, once per attempt (a `blocked`
 *   merge is retried by the Runner, each retry with its own result).
 */

/** Server → Runner: merge the change `changeNumber` of the Projet, at `sha` only. */
export const zMergeLocal = runnerMessage('merge.local', { projectId: zId, changeNumber: zSourceNumber, sha: zSha }).strict();
export type MergeLocal = z.infer<typeof zMergeLocal>;

/**
 * How a merge ended: `merged` (its `mergeSha` the squash commit), `conflict`
 * (the change does not squash on the integration head), `blocked` (the
 * Pilote's uncommitted changes touch the same files: retried when the folder
 * changes), `stale` (the change's head is not `sha`, or it is no longer
 * open: never merged, judged again).
 */
export const LOCAL_MERGE_OUTCOMES = ['merged', 'conflict', 'blocked', 'stale'] as const;
export const zLocalMergeOutcome = z.enum(LOCAL_MERGE_OUTCOMES);
export type LocalMergeOutcome = z.infer<typeof zLocalMergeOutcome>;

/** Runner → server: how the merge of `merge.local` (or a retry of it) ended. */
export const zMergeLocalResult = runnerMessage('merge.local.result', {
  projectId: zId,
  changeNumber: zSourceNumber,
  sha: zSha,
  outcome: zLocalMergeOutcome,
  mergeSha: zSha.optional(),
})
  .strict()
  .refine(({ outcome, mergeSha }) => (outcome === 'merged') === (mergeSha !== undefined), { message: 'mergeSha when merged only', path: ['mergeSha'] });
export type MergeLocalResult = z.infer<typeof zMergeLocalResult>;
