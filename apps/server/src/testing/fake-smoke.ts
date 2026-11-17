import { timingSafeEqual } from 'node:crypto';
import type { Fake } from './fakes.js';

/** What the page keeps of the link it drew for the smoke test: its secret, its Appareil's key, the Projet. */
export interface SmokeLink {
  readonly confirmToken: string;
  readonly pilotId: string;
  readonly projectId: string;
  readonly linkCodeId: string;
  readonly shortId: string;
  readonly secret: Buffer;
  readonly deviceId: string;
  readonly devicePrivateKey: Buffer;
}

/**
 * The page's side of the scenario `smoke` (RUNNER-14), in memory: the
 * compiled Runner links with a code the page drew, so the secret and the
 * Appareil's private key the page would keep are kept here, for
 * `/api/testing/smoke/*` only.
 */
export class FakeSmoke implements Fake {
  private link: SmokeLink | undefined;

  reset(): void {
    this.link = undefined;
  }

  keep(link: SmokeLink): void {
    this.link = link;
  }

  /** The link the scenario drew, when `confirmToken` is its token. */
  byToken(confirmToken: string): SmokeLink | undefined {
    const link = this.link;
    if (!link) return undefined;
    const given = Buffer.from(confirmToken);
    const kept = Buffer.from(link.confirmToken);
    return given.length === kept.length && timingSafeEqual(given, kept) ? link : undefined;
  }
}
