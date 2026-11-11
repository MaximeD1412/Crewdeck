import type { Pairing } from '@crewdeck/contracts';
import { Injectable } from '@nestjs/common';

/** What the binary gets on its first `linked` answer. */
export interface LinkHandoff {
  readonly token: string;
  readonly pairing: Pairing;
}

/**
 * The token of each Runner a confirmed link created, until its binary reads
 * it with `GET /api/runner/link/:linkId` (within 2 s, its polling): given
 * once, then forgotten; never written to the database, which keeps only its
 * hash. In the memory of this server process: a token not read before a
 * restart is lost, and the Pilote links again with a new code.
 */
@Injectable()
export class RunnerLinkTokens {
  private readonly handoffs = new Map<string, LinkHandoff>();

  keep(linkId: string, handoff: LinkHandoff): void {
    this.handoffs.set(linkId, handoff);
  }

  /** The handoff of `linkId`, once: `undefined` after the first call. */
  take(linkId: string): LinkHandoff | undefined {
    const handoff = this.handoffs.get(linkId);
    this.handoffs.delete(linkId);
    return handoff;
  }

  forget(linkId: string): void {
    this.handoffs.delete(linkId);
  }
}
