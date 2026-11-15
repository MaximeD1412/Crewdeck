import type { CheckRun, CheckState, ChecksState, StatusState } from '@crewdeck/contracts';

/** What a check's state reads of a check run (or of a commit status, `statusAsCheck`). */
export type CheckProgress = Pick<CheckRun, 'status' | 'conclusion'>;

const FAILED: readonly CheckRun['conclusion'][] = ['failure', 'cancelled', 'timed_out', 'action_required'];

/** A check run's state: running until completed, then failed (failure, cancelled, timed out, action required) or passed (success, neutral, skipped). */
export const checkStateOf = (check: CheckProgress): CheckState => {
  if (check.status !== 'completed') return 'running';
  return FAILED.includes(check.conclusion) ? 'failed' : 'passed';
};

/** A commit status read as a check run: pending runs, success passes, failure and error fail. */
export const statusAsCheck = (state: StatusState): CheckProgress => {
  if (state === 'pending') return { status: 'in_progress', conclusion: null };
  return { status: 'completed', conclusion: state === 'success' ? 'success' : 'failure' };
};

/** The checks of a commit: none without any, pending while one runs, failed if one failed, else passed. */
export const aggregateChecks = (states: readonly CheckState[]): ChecksState => {
  if (states.length === 0) return 'none';
  if (states.includes('running')) return 'pending';
  if (states.includes('failed')) return 'failed';
  return 'passed';
};
