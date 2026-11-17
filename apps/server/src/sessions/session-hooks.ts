import type { AgentSession } from '@crewdeck/contracts';
import { Injectable } from '@nestjs/common';
import type { Tx } from '../realtime/transactions.js';

/** Called in the transaction that ends a Session, with the Session as it ended. */
export type SessionEndedHook = (tx: Tx, session: AgentSession) => Promise<void>;

/**
 * Who learns, in-process, that a Session ended (RUNNER-9): the StepRun's
 * verdict (RUNNER-12) and the engine register here at their boot. A hook
 * runs in the transaction of the `session.state` that ended the Session: its
 * failure rolls the report back, and the Runner's next report tries again.
 */
@Injectable()
export class SessionHooks {
  private readonly endedHooks = new Set<SessionEndedHook>();

  /** Calls `hook` each time a Session ends; returns its removal. */
  onEnded(hook: SessionEndedHook): () => void {
    this.endedHooks.add(hook);
    return () => this.endedHooks.delete(hook);
  }

  async ended(tx: Tx, session: AgentSession): Promise<void> {
    for (const hook of [...this.endedHooks]) await hook(tx, session);
  }
}
