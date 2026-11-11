import { Injectable } from '@nestjs/common';
import type { WsCredential } from './ws-authenticators.js';

interface Tracked {
  readonly pilotId: string;
  readonly credential: WsCredential;
  readonly end: () => void;
}

/**
 * The open sockets by the credential they were opened with: what ends a
 * credential (a logout, the GitHub sign-in refused) ends its sockets too,
 * once the deletion is committed.
 */
@Injectable()
export class WsRevocations {
  private readonly sockets = new Set<Tracked>();

  /** Calls `end` when `credential` is revoked; returns its untracking. */
  track(pilotId: string, credential: WsCredential, end: () => void): () => void {
    const tracked: Tracked = { pilotId, credential, end };
    this.sockets.add(tracked);
    return () => this.sockets.delete(tracked);
  }

  /** Ends the sockets of `pilotId`'s credentials of `kind`: the one of `id`, or all of them. */
  revoke(pilotId: string, kind: WsCredential['kind'], id?: string): void {
    for (const tracked of [...this.sockets]) {
      const { credential } = tracked;
      if (tracked.pilotId === pilotId && credential.kind === kind && (id === undefined || credential.id === id)) {
        this.sockets.delete(tracked);
        tracked.end();
      }
    }
  }
}
