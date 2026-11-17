import { ARTIFACT_TYPE_LABELS, type ArtifactType, type PhaseRun } from '@crewdeck/contracts';
import { Registry } from '../../realtime/registry.js';
import type { Tx } from '../../realtime/transactions.js';

/**
 * What the engine asks of the module whose items go through a Phase (the
 * Boucle's Tickets, BOUCLE-2; the Conception's Idées, CONCEPTION-1): the
 * item's label, readable by the server (a GitHub Ticket's number and title,
 * a Local one's number only, ADR 0003), and what stopping it means beyond
 * its PhaseRun (the Ticket closed at its Source, the Conception abandoned).
 * Each module adds its own to `PHASE_ITEMS` in its `onModuleInit`, one per
 * type.
 */
export interface PhaseItemHandler {
  readonly itemType: ArtifactType;
  /** The item's label in a Décision about it (`#57 Recherche d’actes`): at most 120 characters. */
  label(tx: Tx, itemId: string): Promise<string>;
  /** The Pilote stopped the item's PhaseRun (« Arrêter »): the PhaseRun is `stopped` already. */
  onStopped(tx: Tx, phaseRun: PhaseRun): Promise<void>;
}

/** A second handler for one type: a bug of the modules' wiring, thrown at start. */
export class DuplicatePhaseItemHandlerError extends Error {
  constructor(itemType: ArtifactType) {
    super(`A handler of the items of type ${itemType} is already registered.`);
    this.name = 'DuplicatePhaseItemHandlerError';
  }
}

/** The item handlers by type, one at most each. */
export class PhaseItemHandlers extends Registry<PhaseItemHandler> {
  override add(handler: PhaseItemHandler): void {
    if (this.of(handler.itemType)) throw new DuplicatePhaseItemHandlerError(handler.itemType);
    super.add(handler);
  }

  of(itemType: string): PhaseItemHandler | undefined {
    return this.all().find((handler) => handler.itemType === itemType);
  }

  /** The item's label: its handler's, else « <Phase's name> · <type's label> ». */
  async label(tx: Tx, phaseRun: Pick<PhaseRun, 'itemType' | 'itemId'>, phaseName: string): Promise<string> {
    const handler = this.of(phaseRun.itemType);
    return handler ? handler.label(tx, phaseRun.itemId) : `${phaseName} · ${ARTIFACT_TYPE_LABELS[phaseRun.itemType]}`;
  }

  /** What stopping the item means beyond its PhaseRun: its handler's `onStopped`, nothing without one. */
  async stopped(tx: Tx, phaseRun: PhaseRun): Promise<void> {
    await this.of(phaseRun.itemType)?.onStopped(tx, phaseRun);
  }
}

/** The token of the item handlers: a `PhaseItemHandlers`, each item's module adds its own in `onModuleInit`. */
export const PHASE_ITEMS = Symbol('PHASE_ITEMS');
