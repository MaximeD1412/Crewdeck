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

  /** Ends the sockets of `pilotId`'s credentials of `kind` whose id is in `ids`. */
  revoke(pilotId: string, kind: WsCredential['kind'], ids: readonly string[]): void {
    if (ids.length === 0) return;
    const revoked = new Set(ids);
    for (const tracked of [...this.sockets]) {
      const { credential } = tracked;
      if (tracked.pilotId === pilotId && credential.kind === kind && revoked.has(credential.id)) {
        this.sockets.delete(tracked);
        tracked.end();
      }
    }
  }
}
