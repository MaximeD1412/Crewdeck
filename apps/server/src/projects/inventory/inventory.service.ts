import { type InventoryReport, type StepRun, zInventoryReport } from '@crewdeck/contracts';
import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { DecisionsService, type RaiseInput } from '../../decisions/decisions.service.js';
import { Engine, PREPARATION_TEMPLATE } from '../../process/engine/engine.js';
import { PHASE_ITEMS, type PhaseItemHandlers } from '../../process/engine/items.js';
import { AgentSteps } from '../../process/engine/kinds/agent.js';
import { STEP_KIND_HANDLERS, type StepKindHandlers } from '../../process/engine/kinds/handler.js';
import { type StepRunFinished, StepRunHooks } from '../../process/engine/kinds/step-run-hooks.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { EventsWriter } from '../../realtime/events.writer.js';
import { Transactions, type Tx } from '../../realtime/transactions.js';
import { AiAccounts } from '../../runners/ai-accounts/ai-accounts.js';
import { currentPilotId, runInPilotScope } from '../../scope/scope.context.js';
import { SettingsService } from '../../settings/settings.service.js';
import { ProjectPreparation } from '../project-preparation.js';
import { inventoryStateRow, PROJECT_VIEW, toProject } from '../project.view.js';
import { INVENTORY_KIND, INVENTORY_PHASE, inventoryHeadOf } from './inventory.kind.js';

/** What « Inventaire à approuver » names of a Local Projet, whose name the server cannot read. */
const LOCAL_LABEL = 'Inventaire';

/** « Inventaire à approuver » (US-3) of `projectId`: its name when readable, its page to read it. */
export const inventoryReviewDecision = (projectId: string, displayName: string | null): RaiseInput => ({
  kind: 'inventory-review',
  projectId,
  projectName: displayName,
  subjectType: 'project',
  subjectId: projectId,
  label: displayName ?? LOCAL_LABEL,
  metaParts: ['Projet existant'],
  tone: 'accent',
  link: `/projets/${projectId}`,
  params: {},
});

/**
 * The Inventaire of an existing code (PROJET-4, US-3): a Projet with code
 * runs « Préparation » before its Process, one PhaseRun whose Étape
 * « Inventaire » drafts the glossary, the choix techniques and the list of
 * what exists on `crewdeck/inventaire`, in the Rôle Conception's Moteur.
 *
 * It starts when the Projet is ready (`ProjectPreparation`: followed, or a
 * Local one whose folder became `present`), and for a Projet still
 * `pending` (followed before the Rôle Conception had a Moteur) at boot and
 * after each report of the Comptes IA. Its report's counts go to
 * `projects.inventory_figures`; its Contrat passed, the Projet is
 * `to-approve` at the verdict's head and « Inventaire à approuver » is
 * raised. Incomplete or failed, it stays `drafting` (ATOI-2 raises its own
 * Décision, its rerun lands here again). The server reads no file of it:
 * counts and a SHA only (ADR 0003).
 */
@Injectable()
export class InventoryService implements OnModuleInit, OnModuleDestroy {
  private readonly removals: (() => void)[] = [];

  constructor(
    private readonly prisma: PrismaService,
    private readonly transactions: Transactions,
    private readonly events: EventsWriter,
    private readonly engine: Engine,
    private readonly steps: AgentSteps,
    private readonly hooks: StepRunHooks,
    private readonly decisions: DecisionsService,
    private readonly settings: SettingsService,
    private readonly preparation: ProjectPreparation,
    private readonly accounts: AiAccounts,
    @Inject(STEP_KIND_HANDLERS) private readonly handlers: StepKindHandlers,
    @Inject(PHASE_ITEMS) private readonly items: PhaseItemHandlers,
    @InjectPinoLogger(InventoryService.name) private readonly logger: PinoLogger,
  ) {}

  onModuleInit(): void {
    this.handlers.add(this.steps.defineAgentKind(INVENTORY_KIND));
    this.items.add({
      itemType: 'inventory',
      label: async (tx, projectId) => (await tx.project.findUnique({ where: { id: projectId }, select: { displayName: true } }))?.displayName ?? null,
      link: (_tx, projectId) => Promise.resolve(`/projets/${projectId}`),
      onStopped: () => Promise.resolve(),
    });
    this.steps.registerStepReport('inventory', zInventoryReport, (tx, run, report) => this.reported(tx, run.phaseRun.projectId, report.figures));
    this.removals.push(
      this.preparation.onReady(async (tx, projectId) => {
        await this.startIfReady(tx, projectId);
      }),
      this.hooks.onFinished((tx, stepRun, finished) => this.finished(tx, stepRun, finished)),
      this.accounts.onRecorded((pilotId) => {
        this.startPending(pilotId).catch((error: unknown) => this.logger.error({ err: error }, 'inventory start failed'));
      }),
    );
  }

  onModuleDestroy(): void {
    for (const remove of this.removals.splice(0)) remove();
  }

  /**
   * The Inventaire of `projectId` when it waits for one (`pending`), its code
   * reachable (a GitHub Projet, a Local one whose folder is `present`) and
   * the Rôle Conception has a Moteur: its PhaseRun, the Projet `drafting`.
   * Whether it started.
   */
  async startIfReady(tx: Tx, projectId: string): Promise<boolean> {
    const pilotId = currentPilotId();
    await this.events.lock(tx, pilotId);
    const project = await tx.project.findUnique({ where: { id: projectId }, select: { inventoryState: true, folderState: true } });
    if (!project || project.inventoryState !== 'pending') return false;
    if (project.folderState !== null && project.folderState !== 'present') return false;
    const { roles } = await this.settings.effective(pilotId, projectId);
    if (!roles.design) return false;
    await this.engine.admit(tx, { projectId, phaseId: INVENTORY_PHASE, item: { type: 'inventory', id: projectId }, builtinTemplate: PREPARATION_TEMPLATE });
    await this.writeProject(tx, projectId, { inventoryState: inventoryStateRow('drafting') });
    return true;
  }

  /** The Pilote's Projets still `pending`, each in its own transaction; how many started. */
  async startPending(pilotId: string): Promise<number> {
    return runInPilotScope(pilotId, async () => {
      const pending = await this.prisma.scoped.project.findMany({ where: { inventoryState: 'pending' }, select: { id: true }, orderBy: { id: 'asc' } });
      let started = 0;
      for (const { id } of pending) if (await this.transactions.run((tx) => this.startIfReady(tx, id))) started += 1;
      return started;
    });
  }

  private async reported(tx: Tx, projectId: string | null, figures: InventoryReport): Promise<void> {
    if (projectId === null) return;
    await tx.project.update({ where: { id: projectId }, data: { inventoryFigures: { ...figures } } });
  }

  private async finished(tx: Tx, stepRun: StepRun, finished: StepRunFinished): Promise<void> {
    if (stepRun.kind !== 'inventory' || stepRun.projectId === null || finished.status !== 'passed') return;
    const projectId = stepRun.projectId;
    const project = await this.writeProject(tx, projectId, {
      inventoryState: inventoryStateRow('to-approve'),
      inventoryHeadSha: inventoryHeadOf(stepRun.contratVerdict?.headSha),
    });
    await this.decisions.raise(tx, inventoryReviewDecision(projectId, project.displayName));
  }

  private async writeProject(tx: Tx, projectId: string, data: { inventoryState: ReturnType<typeof inventoryStateRow>; inventoryHeadSha?: string | null }): Promise<{ displayName: string | null }> {
    const pilotId = currentPilotId();
    await this.events.lock(tx, pilotId);
    const row = await tx.project.update({ where: { id: projectId }, data, select: PROJECT_VIEW });
    const seq = await this.events.write(tx, pilotId, 'project.upserted', toProject(row));
    await tx.project.update({ where: { id: projectId }, data: { lastSeq: seq } });
    return row;
  }
}
