import type { ArtifactRef, PhaseRun, ProcessDefinition, Step, StepKind, StepRun, StepRunVerdict } from '@crewdeck/contracts';
import { Registry } from '../../../realtime/registry.js';
import type { Tx } from '../../../realtime/transactions.js';

/**
 * The work of one kind of Étape (ADR 0011, « The engine »): an agent's
 * Session, a gate's Décision, a Commande, the checks, the merge. Each
 * Étape's ticket adds its handler to `STEP_KIND_HANDLERS` in its module's
 * `onModuleInit`, one per kind.
 *
 * The handler owns the work, the engine the sequence: a handler never writes
 * a StepRun's state, it says it. Its domain module (`sessions`, `decisions`,
 * `tickets`…) calls `Engine.signal` when its thing ends; the engine then asks
 * `onSignal` what that means.
 */

/** What a handler is given: the PhaseRun, its StepRun, the Étape of the pinned version, and that version's definition. */
export interface StepRunContext {
  readonly phaseRun: PhaseRun;
  readonly stepRun: StepRun;
  readonly step: Step;
  readonly definition: ProcessDefinition;
}

/**
 * What a signal means for a StepRun: `done` with its outputs on its Sorties
 * (and its Verdict when it judges); `failed`, which waits for `retry`;
 * `interrupted` or `blocked`, which keep the PhaseRun open; `running` or
 * `waiting`, which resume an `interrupted` or `blocked` one. `failure` is a
 * code (`checks-failed`), never free text (ADR 0003).
 */
export type StepResult =
  | { readonly state: 'done'; readonly outputs: ArtifactRef[]; readonly verdict?: StepRunVerdict }
  | { readonly state: 'failed'; readonly failure: string }
  | { readonly state: 'interrupted' | 'blocked'; readonly failure: string }
  | { readonly state: 'running' | 'waiting' };

/** A start that could not begin its work: the StepRun `failed` with its code, which waits for `retry` as any other failure. */
export interface StepStartFailed {
  readonly state: 'failed';
  readonly failure: string;
}

export interface StepKindHandler {
  readonly kind: StepKind;
  /**
   * The StepRun was just written `running`: begins its work, says `running`
   * (an agent, a Commande) or `waiting` (on the Pilote), or `failed` when its
   * work cannot begin yet (an agent's Rôle without a Moteur).
   */
  start(tx: Tx, run: StepRunContext): Promise<'running' | 'waiting' | StepStartFailed>;
  /** What `signal` means for the StepRun; `null`: nothing changes. */
  onSignal(tx: Tx, run: StepRunContext, signal: unknown): Promise<StepResult | null>;
  /** Ends its work (a Session cut, a Décision withdrawn) before the StepRun is `stopped` or `superseded`. */
  stop?(tx: Tx, run: StepRunContext): Promise<void>;
}

/** A second handler for one kind: a bug of the modules' wiring, thrown at start. */
export class DuplicateStepKindHandlerError extends Error {
  constructor(kind: StepKind) {
    super(`A handler of the Étape kind ${kind} is already registered.`);
    this.name = 'DuplicateStepKindHandlerError';
  }
}

/** The handlers by kind, one at most each. */
export class StepKindHandlers extends Registry<StepKindHandler> {
  override add(handler: StepKindHandler): void {
    if (this.of(handler.kind)) throw new DuplicateStepKindHandlerError(handler.kind);
    super.add(handler);
  }

  /** A test's stand-in for the kind's handler: the one registered, if any, removed first. */
  replace(handler: StepKindHandler): void {
    const registered = this.of(handler.kind);
    if (registered) this.remove(registered);
    super.add(handler);
  }

  of(kind: string): StepKindHandler | undefined {
    return this.all().find((handler) => handler.kind === kind);
  }
}

/** The token of the handlers: a `StepKindHandlers`, each Étape's module adds its own in `onModuleInit`. */
export const STEP_KIND_HANDLERS = Symbol('STEP_KIND_HANDLERS');
