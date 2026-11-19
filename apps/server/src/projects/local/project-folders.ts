import { Injectable, type OnModuleInit } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { DecisionsService, type RaiseInput } from '../../decisions/decisions.service.js';
import type { ProjectFolderState } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { EventsWriter } from '../../realtime/events.writer.js';
import { Transactions } from '../../realtime/transactions.js';
import { RunnerDispatcher } from '../../runners/runner-dispatcher.js';
import { runInPilotScope } from '../../scope/scope.context.js';
import { PROJECT_VIEW, toProject } from '../project.view.js';

/** The outcome of « Dossier du Projet introuvable » once the Runner has the folder again. */
export const FOLDER_BACK = 'folder-back';

/**
 * « Dossier du Projet introuvable » of the Local Projet `projectId` (ADR
 * 0012): its folder gone from `machine`, or another Runner linked. Halt,
 * leading to choosing its folder again; no name (sealed: the page names it).
 */
export const folderMissingDecision = (projectId: string, machine: string | null): RaiseInput => ({
  kind: 'project.folder-missing',
  projectId,
  projectName: null,
  subjectType: 'project',
  subjectId: projectId,
  label: 'Choisis à nouveau son dossier',
  metaParts: machine === null ? [] : [machine],
  tone: 'halt',
  link: `/projets/ajouter?projet=${projectId}`,
  params: {},
});

/**
 * What the Runner says of the Local Projets' folders (`projects.folders`):
 * each Projet with a folder becomes `present` when listed, `missing` when
 * not. A change is written in one transaction per Projet with its
 * `project.upserted`, and raises (`missing`) or resolves (`present`) its
 * Décision. One report after the other per Pilote.
 */
@Injectable()
export class ProjectFolders implements OnModuleInit {
  private readonly queues = new Map<string, Promise<void>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly transactions: Transactions,
    private readonly events: EventsWriter,
    private readonly decisions: DecisionsService,
    private readonly dispatcher: RunnerDispatcher,
    @InjectPinoLogger(ProjectFolders.name) private readonly logger: PinoLogger,
  ) {}

  onModuleInit(): void {
    this.dispatcher.registerRunnerHandler('projects.folders', (message, context) => this.reported(context.pilotId, message.present));
  }

  private reported(pilotId: string, present: readonly string[]): Promise<void> {
    const previous = this.queues.get(pilotId) ?? Promise.resolve();
    const run = previous.then(() => runInPilotScope(pilotId, () => this.sync(pilotId, new Set(present))));
    const settled = run.catch((error: unknown) => this.logger.error({ err: error }, 'projects folders sync failed'));
    this.queues.set(pilotId, settled);
    void settled.then(() => {
      if (this.queues.get(pilotId) === settled) this.queues.delete(pilotId);
    });
    return settled;
  }

  private async sync(pilotId: string, present: ReadonlySet<string>): Promise<void> {
    const projects = await this.prisma.scoped.project.findMany({ where: { folderState: { not: null } }, select: { id: true, folderState: true } });
    for (const { id, folderState } of projects) {
      const next: ProjectFolderState = present.has(id) ? 'present' : 'missing';
      if (folderState !== next) await this.write(pilotId, id, next);
    }
  }

  private write(pilotId: string, id: string, next: ProjectFolderState): Promise<void> {
    return this.transactions.run(async (tx) => {
      await this.events.lock(tx, pilotId);
      const current = await tx.project.findUnique({ where: { id }, select: { folderState: true } });
      if (!current || current.folderState === next) return;
      const view = toProject(await tx.project.update({ where: { id }, data: { folderState: next }, select: PROJECT_VIEW }));
      const seq = await this.events.write(tx, pilotId, 'project.upserted', view);
      await tx.project.update({ where: { id }, data: { lastSeq: seq } });
      if (next === 'present') {
        await this.decisions.resolve(tx, 'project.folder-missing', id, FOLDER_BACK);
        return;
      }
      const runner = await tx.runner.findFirst({ where: { revokedAt: null }, select: { machine: true } });
      await this.decisions.raise(tx, folderMissingDecision(id, runner?.machine ?? null));
    });
  }
}
