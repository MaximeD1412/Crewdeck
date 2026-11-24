import { Injectable } from '@nestjs/common';
import type { Tx } from '../realtime/transactions.js';

/** Called in the transaction that made `projectId` ready to prepare; its failure rolls it back. */
export type ProjectReadyHook = (tx: Tx, projectId: string) => Promise<void>;

/**
 * Who learns, in-process, that a Projet may be prepared before its Process
 * (PROJET-4): one followed, a Local one whose folder became `present`. The
 * Inventaire (`inventory/`) registers here at its boot; it decides from the
 * Projet's row whether there is anything to do. A module of its own, so that
 * the Projets need not import what the Inventaire imports (its Session, the
 * Paramètres, which import the Projets).
 */
@Injectable()
export class ProjectPreparation {
  private readonly hooks = new Set<ProjectReadyHook>();

  /** Calls `hook` each time a Projet may be ready; returns its removal. */
  onReady(hook: ProjectReadyHook): () => void {
    this.hooks.add(hook);
    return () => this.hooks.delete(hook);
  }

  async ready(tx: Tx, projectId: string): Promise<void> {
    for (const hook of [...this.hooks]) await hook(tx, projectId);
  }
}
