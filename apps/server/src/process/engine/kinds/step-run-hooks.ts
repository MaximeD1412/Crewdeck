import type { StepRun, Verdict } from '@crewdeck/contracts';
import { Injectable } from '@nestjs/common';
import type { Tx } from '../../../realtime/transactions.js';

/**
 * How an agent's StepRun finished (RUNNER-12): `passed`, its Contrat passed
 * (or it has none) and its outputs given; `incomplete`, its Contrat failed
 * rules, said by `verdict`; `failed`, its Session did not end well, said by
 * `failure` (a code: `session-error`, `contract-unchecked`).
 */
export interface StepRunFinished {
  readonly status: 'passed' | 'incomplete' | 'failed';
  readonly verdict?: Verdict;
  readonly failure?: string;
}

/** Called once per StepRun, in the transaction that finishes it. */
export type StepRunFinishedHook = (tx: Tx, stepRun: StepRun, finished: StepRunFinished) => Promise<void>;

/**
 * Who learns, in-process, that an agent's StepRun finished: the Décisions
 * raised from a StepRun (ATOI-2) register here at their boot. A hook runs in
 * the transaction that finishes the StepRun: its failure rolls it back.
 */
@Injectable()
export class StepRunHooks {
  private readonly finishedHooks = new Set<StepRunFinishedHook>();

  /** Calls `hook` each time an agent's StepRun finishes; returns its removal. */
  onFinished(hook: StepRunFinishedHook): () => void {
    this.finishedHooks.add(hook);
    return () => this.finishedHooks.delete(hook);
  }

  async finished(tx: Tx, stepRun: StepRun, finished: StepRunFinished): Promise<void> {
    for (const hook of [...this.finishedHooks]) await hook(tx, stepRun, finished);
  }
}
