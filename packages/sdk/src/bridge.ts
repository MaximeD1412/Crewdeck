import type { CdActionDetail } from '@crewdeck/contracts/composants';

/**
 * What a Skin's code talks to the core through (ADR 0006): data in, actions
 * out. At the MVP the core implements it in the page; from the Bêta a Skin in a
 * sandboxed iframe gets the same contract over `postMessage`.
 */
export interface Bridge {
  /** Calls `cb` with the topic's data now if known, then on each change; returns the unsubscribe. */
  subscribe(topic: string, cb: (data: unknown) => void): () => void;
  /** Hands an action to the core, as a `cd-action` would. */
  act(detail: CdActionDetail): void;
}
