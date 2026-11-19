import { Injectable } from '@nestjs/common';
import type { WsCredential } from './ws-authenticators.js';

/** Why a socket ends: its credential revoked, or the Appareil it named (E2E-4). */
export type WsRevoked = 'credential' | 'device';

interface Tracked {
  readonly pilotId: string;
  readonly credential: WsCredential;
  /** The Appareil the tab named (`?device=<id>`), if any. */
  readonly deviceId: string | undefined;
  readonly end: (why: WsRevoked) => void;
}

/**
 * The open sockets by the credential they were opened with: what ends a
 * credential (a logout, the GitHub sign-in refused) ends its sockets too,
 * once the deletion is committed. A tab's socket that named an Appareil ends
 * too once that Appareil is revoked (E2E-4).
 */
@Injectable()
export class WsRevocations {
  private readonly sockets = new Set<Tracked>();

  /** Calls `end` when `credential`, or the Appareil `deviceId`, is revoked; returns its untracking. */
  track(pilotId: string, credential: WsCredential, end: (why: WsRevoked) => void, deviceId?: string): () => void {
    const tracked: Tracked = { pilotId, credential, deviceId, end };
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
        tracked.end('credential');
      }
    }
  }

  /** Ends the sockets of `pilotId` that named the Appareil `deviceId`, once its revocation is committed. */
  revokeDevice(pilotId: string, deviceId: string): void {
    for (const tracked of [...this.sockets]) {
      if (tracked.pilotId === pilotId && tracked.deviceId === deviceId) {
        this.sockets.delete(tracked);
        tracked.end('device');
      }
    }
  }
}
