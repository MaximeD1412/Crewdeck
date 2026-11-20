import { type ArtifactRef, ideaItemAad, zIdeaAnalysisFigures, zSealedItem } from '@crewdeck/contracts';
import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { IDEA_ANALYSIS_KIND, IdeaAnalysis } from '../../../ideas/analysis.js';
import type { Tx } from '../../../realtime/transactions.js';
import { RunnerWaitingWork } from '../../../runners/waiting-work.js';
import { PHASE_ITEMS, type PhaseItemHandlers } from '../items.js';
import { AgentSteps } from './agent.js';
import { STEP_KIND_HANDLERS, type StepKindHandler, type StepKindHandlers, type StepRunContext } from './handler.js';
import { StepRunHooks } from './step-run-hooks.js';

/** The Sortie an analysis gives its Idée on: the Étape's `idea` port. */
const ideaPortOf = (run: StepRunContext): string => run.step.outputs.find((port) => port.type === 'idea')?.id ?? 'idee';

/**
 * The kind `idea-analysis` (IDEE-2, ADR 0011): an agent Étape whose Session
 * runs in a scratch directory (no worktree: an Idée may have no Projet, and
 * the analysis reads no code), titled with the Idée's sealed text, reading
 * the Idée and the other open Idées from its step's context. Its report's
 * figures are kept until its Contrat passed, then the Idée is `analysed`;
 * its waiting Sessions are listed by `idea-analysis` in « Runner hors
 * ligne », those of no Projet as « Idées ». The Idée is the item of its
 * Phase: « Idée #<n> », its page `/idees/<id>`.
 */
@Injectable()
export class IdeaAnalysisKind implements OnModuleInit, OnModuleDestroy {
  private readonly removals: (() => void)[] = [];

  constructor(
    @Inject(STEP_KIND_HANDLERS) private readonly handlers: StepKindHandlers,
    @Inject(PHASE_ITEMS) private readonly items: PhaseItemHandlers,
    private readonly steps: AgentSteps,
    private readonly hooks: StepRunHooks,
    private readonly work: RunnerWaitingWork,
    private readonly analysis: IdeaAnalysis,
    @InjectPinoLogger(IdeaAnalysisKind.name) private readonly logger: PinoLogger,
  ) {}

  onModuleInit(): void {
    this.handlers.add(this.handler());
    this.steps.registerStepReport(IDEA_ANALYSIS_KIND, zIdeaAnalysisFigures, async (tx, run, report) => {
      // Ids only: the figures and the sealed sentences are never logged (ADR 0003).
      this.logger.info({ stepRunId: run.stepRun.id, ideaId: run.phaseRun.itemId }, 'idea analysis reported');
      await this.analysis.reported(tx, run, report);
    });
    this.items.add({
      itemType: 'idea',
      label: async (tx, ideaId) => {
        const idea = await tx.idea.findUnique({ where: { id: ideaId }, select: { number: true } });
        return idea ? `Idée #${idea.number}` : null;
      },
      link: (_tx, ideaId) => Promise.resolve(`/idees/${ideaId}`),
      onStopped: (tx, phaseRun) => this.analysis.stopped(tx, phaseRun.itemId),
    });
    this.removals.push(
      this.hooks.onFinished((tx, stepRun, finished) => (stepRun.kind === IDEA_ANALYSIS_KIND ? this.analysis.finished(tx, stepRun, finished) : Promise.resolve())),
      this.work.register({ key: IDEA_ANALYSIS_KIND, projectsWaiting: () => this.analysis.projectsWaiting() }),
    );
  }

  onModuleDestroy(): void {
    for (const remove of this.removals.splice(0)) remove();
  }

  private handler(): StepKindHandler {
    const agent = this.steps.defineAgentKind({
      kind: IDEA_ANALYSIS_KIND,
      title: (tx, run) => this.titleOf(tx, run.phaseRun.itemId),
      branch: () => null,
      outputs: (_tx, run): ArtifactRef[] => [{ portId: ideaPortOf(run), type: 'idea', id: run.phaseRun.itemId }],
      stepContext: async (tx, run) => ({ ideas: await this.analysis.context(tx, run.phaseRun.itemId) }),
      waitingWork: 'own',
    });
    return {
      ...agent,
      start: async (tx, run) => {
        const state = await agent.start(tx, run);
        await this.analysis.started(tx, run);
        return state;
      },
    };
  }

  /** The Session's title: the Idée's text, sealed as the page sealed it, which the page opens. */
  private async titleOf(tx: Tx, ideaId: string) {
    const idea = await tx.idea.findUniqueOrThrow({ where: { id: ideaId }, select: { text: true } });
    return { ...zSealedItem.parse(idea.text), aad: ideaItemAad(ideaId, 'text') };
  }
}
