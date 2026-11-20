import type { LocalMergeOutcome, MergeLocalResult } from '@crewdeck/contracts';
import { Injectable, type OnModuleInit } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { DecisionsService, type RaiseInput } from '../../decisions/decisions.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { Transactions, type Tx } from '../../realtime/transactions.js';
import { RunnerCommands } from '../../runners/runner-commands.service.js';
import { RunnerDispatcher } from '../../runners/runner-dispatcher.js';
import { runInPilotScope } from '../../scope/scope.context.js';

/** What a caller asks merged: the change `changeNumber` of a Local Projet, at the `sha` every Verdict judged. */
export interface LocalMergeRequest {
  projectId: string;
  changeNumber: number;
  sha: string;
}

/** How a merge of the Runner ended (`merge.local.result`), for its caller. */
export interface LocalMergeFinished extends LocalMergeRequest {
  pilotId: string;
  outcome: LocalMergeOutcome;
  /** The squash commit, when `merged`. */
  mergeSha: string | null;
}

/** Called in the transaction of a result, `local-merge.finished`: its failure rolls the result back. */
export type LocalMergeHook = (tx: Tx, finished: LocalMergeFinished) => Promise<void>;

/** The subject of a change's « Merge en attente »: its Projet and its number. */
export const mergeSubject = (projectId: string, changeNumber: number): string => `${projectId}:${changeNumber}`;

/**
 * « Merge en attente » of a change the Pilote's uncommitted work blocks:
 * caution, no action (the Runner retries the merge, the next result resolves
 * it), never a file's name (they stay on the Runner, ADR 0003).
 */
export const blockedDecision = (projectId: string, changeNumber: number): RaiseInput => ({
  kind: 'merge.local-blocked',
  projectId,
  projectName: null,
  subjectType: 'code-change',
  subjectId: mergeSubject(projectId, changeNumber),
  label: 'Merge en attente : tes modifications touchent les mêmes fichiers',
  metaParts: [`Changement #${changeNumber}`],
  tone: 'caution',
  link: `/projets/${projectId}`,
  params: {},
});

/**
 * The merges of a Local Projet's changes of code (SOURCE-5, ADR 0012, « The
 * Local folder »): `request` sends `merge.local` to the Pilote's Runner (422
 * `runner.offline`), the caller being the Boucle's `merge` or an approval;
 * each `merge.local.result`, in one transaction, raises « Merge en attente »
 * when `blocked` (one per change), resolves it otherwise with the result's
 * outcome, and calls the `onFinished` hooks. One result after the other per
 * Pilote.
 */
@Injectable()
export class LocalMerges implements OnModuleInit {
  private readonly hooks = new Set<LocalMergeHook>();
  private readonly queues = new Map<string, Promise<void>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly transactions: Transactions,
    private readonly decisions: DecisionsService,
    private readonly commands: RunnerCommands,
    private readonly dispatcher: RunnerDispatcher,
    @InjectPinoLogger(LocalMerges.name) private readonly logger: PinoLogger,
  ) {}

  onModuleInit(): void {
    this.dispatcher.registerRunnerHandler('merge.local.result', (message, context) => this.reported(context.pilotId, message));
  }

  /** Calls `hook` on each result of a merge (`local-merge.finished`); returns its removal. */
  onFinished(hook: LocalMergeHook): () => void {
    this.hooks.add(hook);
    return () => this.hooks.delete(hook);
  }

  /** Asks the Pilote's Runner to merge the change at `sha` only; its result comes as `merge.local.result`. */
  request(pilotId: string, { projectId, changeNumber, sha }: LocalMergeRequest): void {
    this.commands.send(pilotId, { type: 'merge.local', projectId, changeNumber, sha });
    this.logger.info({ projectId, changeNumber }, 'local.merge.requested');
  }

  private reported(pilotId: string, message: MergeLocalResult): Promise<void> {
    const previous = this.queues.get(pilotId) ?? Promise.resolve();
    const run = previous.then(() => runInPilotScope(pilotId, () => this.finished(pilotId, message)));
    const settled = run.catch((error: unknown) => this.logger.error({ err: error, projectId: message.projectId }, 'local merge result failed'));
    this.queues.set(pilotId, settled);
    void settled.then(() => {
      if (this.queues.get(pilotId) === settled) this.queues.delete(pilotId);
    });
    return run;
  }

  private async finished(pilotId: string, message: MergeLocalResult): Promise<void> {
    const { projectId, changeNumber, sha, outcome } = message;
    const project = await this.prisma.scoped.project.findFirst({ where: { id: projectId }, select: { id: true } });
    if (!project) {
      this.logger.warn({ projectId }, 'local merge result of an unknown project');
      return;
    }
    const finished: LocalMergeFinished = { pilotId, projectId, changeNumber, sha, outcome, mergeSha: message.mergeSha ?? null };
    await this.transactions.run(async (tx) => {
      if (outcome === 'blocked') await this.decisions.raise(tx, blockedDecision(projectId, changeNumber));
      else await this.decisions.resolve(tx, 'merge.local-blocked', mergeSubject(projectId, changeNumber), outcome);
      for (const hook of [...this.hooks]) await hook(tx, finished);
    });
    this.logger.info({ projectId, changeNumber, outcome }, 'local.merge.result');
  }
}
