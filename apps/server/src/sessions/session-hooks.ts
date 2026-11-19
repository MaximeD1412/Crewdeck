import type { AgentSession } from '@crewdeck/contracts';
import { Injectable } from '@nestjs/common';
import type { Tx } from '../realtime/transactions.js';

/** Called in the transaction that changes or ends a Session, with the Session as it now is. */
export type SessionHook = (tx: Tx, session: AgentSession) => Promise<void>;

/**
 * Who learns, in-process, that a Session changed or ended (RUNNER-9): the
 * agent Étapes' StepRuns (RUNNER-12) register here at their boot. A hook
 * runs in the transaction of the change: its failure rolls the change back,
 * and the Runner's next report tries again.
 */
@Injectable()
export class SessionHooks {
  private readonly endedHooks = new Set<SessionHook>();
  private readonly changedHooks = new Set<SessionHook>();

  /** Calls `hook` each time a Session ends; returns its removal. */
  onEnded(hook: SessionHook): () => void {
    this.endedHooks.add(hook);
    return () => this.endedHooks.delete(hook);
  }

  /**
   * Calls `hook` each time a Session is written with its event: started,
   * `active`, `waiting`, `stopped`, `interrupted`, resumed, and `ended`
   * (before the `onEnded` hooks); returns its removal.
   */
  onChanged(hook: SessionHook): () => void {
    this.changedHooks.add(hook);
    return () => this.changedHooks.delete(hook);
  }

  async ended(tx: Tx, session: AgentSession): Promise<void> {
    for (const hook of [...this.endedHooks]) await hook(tx, session);
  }

  async changed(tx: Tx, session: AgentSession): Promise<void> {
    for (const hook of [...this.changedHooks]) await hook(tx, session);
  }
}
