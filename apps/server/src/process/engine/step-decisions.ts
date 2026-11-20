import { DECISION_LABEL_MAX, DECISION_META_PART_MAX, type DecisionKind, type StepRun } from '@crewdeck/contracts';
import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { DecisionsService, type RaiseInput } from '../../decisions/decisions.service.js';
import type { Tx } from '../../realtime/transactions.js';
import { Engine } from './engine.js';
import { PHASE_RUN_VIEW } from './engine.view.js';
import { PHASE_ITEMS, type PhaseItemHandlers } from './items.js';
import { AGENT_STEP_FAILURES } from './kinds/agent.js';
import { type StepRunFinished, StepRunHooks } from './kinds/step-run-hooks.js';

/** The two Décisions a pass of an agent Étape raises (ATOI-2, ADR 0005), each about one StepRun. */
export const STEP_DECISION_KINDS = ['contract-incomplete', 'step-failed'] as const satisfies readonly DecisionKind[];

/** The failures of a Session that raise « Étape échouée »: any other one is a bug, logged. */
const SESSION_FAILURES: ReadonlySet<string> = new Set([AGENT_STEP_FAILURES.sessionError, AGENT_STEP_FAILURES.sessionStopped]);

/** The failures « Relancer l'Étape » answers: those that raised one of the two Décisions. */
export const RERUNNABLE_FAILURES: ReadonlySet<string> = new Set([AGENT_STEP_FAILURES.contractIncomplete, ...SESSION_FAILURES]);

/**
 * « Contrat incomplet » and « Étape échouée » (ATOI-2, US-48), for every
 * agent Étape, from `StepRunHooks.onFinished` in the transaction that
 * finishes the StepRun: an `incomplete` verdict raises the first, a Session
 * ended in error or stopped by the Runner the second, one per StepRun; a
 * later StepRun of the same PhaseRun and Étape that passes resolves the
 * earlier ones' still open, `passed`. A Session stopped by the Pilote is no
 * failure (the StepRun is `interrupted`, never finished here).
 *
 * The row holds no content (ADR 0003, 0005): ids, the failed rules' ids (the
 * page reads their labels from the same Contrat declarations), the Étape's
 * and Phase's names in the PhaseRun's pinned definition (the Pilote may have
 * renamed them, ADR 0011), and the item's readable label from its module
 * (`PHASE_ITEMS`), none without one.
 */
@Injectable()
export class StepDecisions implements OnModuleInit, OnModuleDestroy {
  private removal: (() => void) | undefined;

  constructor(
    private readonly hooks: StepRunHooks,
    private readonly decisions: DecisionsService,
    private readonly engine: Engine,
    @Inject(PHASE_ITEMS) private readonly items: PhaseItemHandlers,
    @InjectPinoLogger(StepDecisions.name) private readonly logger: PinoLogger,
  ) {}

  onModuleInit(): void {
    this.removal = this.hooks.onFinished((tx, stepRun, finished) => this.onFinished(tx, stepRun, finished));
  }

  onModuleDestroy(): void {
    this.removal?.();
  }

  private async onFinished(tx: Tx, stepRun: StepRun, finished: StepRunFinished): Promise<void> {
    switch (finished.status) {
      case 'passed':
        await this.resolveEarlier(tx, stepRun);
        return;
      case 'incomplete': {
        const verdict = finished.verdict ?? stepRun.contratVerdict;
        await this.raise(tx, stepRun, 'contract-incomplete', {
          contractId: verdict?.contractId ?? null,
          contractVersion: verdict?.version ?? null,
          failedRuleIds: (verdict?.failedRuleIds ?? []).join(','),
          failedCount: verdict?.failedRuleIds.length ?? 0,
        });
        return;
      }
      case 'failed':
        if (finished.failure !== undefined && SESSION_FAILURES.has(finished.failure)) {
          await this.raise(tx, stepRun, 'step-failed', { failure: finished.failure });
          return;
        }
        this.logger.error({ stepRunId: stepRun.id, kind: stepRun.kind, failure: finished.failure ?? null }, 'An agent StepRun failed without a Décision for its failure');
    }
  }

  private async raise(tx: Tx, stepRun: StepRun, kind: (typeof STEP_DECISION_KINDS)[number], extra: RaiseInput['params']): Promise<void> {
    const row = await tx.phaseRun.findUniqueOrThrow({ where: { id: stepRun.phaseRunId }, select: PHASE_RUN_VIEW });
    const definition = await this.engine.definitionFor(tx, row);
    const stepName = definition.steps.find((step) => step.id === stepRun.stepId)?.name ?? stepRun.stepId;
    const phaseName = definition.phases.find((phase) => phase.id === row.phaseId)?.name;
    const project = row.projectId === null ? null : await tx.project.findUnique({ where: { id: row.projectId }, select: { displayName: true } });
    const item = await this.items.describe(tx, row);
    await this.decisions.raise(tx, {
      kind,
      projectId: row.projectId,
      projectName: project?.displayName ?? null,
      subjectType: 'step-run',
      subjectId: stepRun.id,
      label: (item.label === null ? stepName : `${stepName} · ${item.label}`).slice(0, DECISION_LABEL_MAX),
      metaParts: phaseName ? [phaseName.slice(0, DECISION_META_PART_MAX)] : [],
      tone: 'caution',
      link: item.link,
      params: {
        stepRunId: stepRun.id,
        phaseRunId: row.id,
        stepId: stepRun.stepId,
        itemType: row.itemType,
        itemId: row.itemId,
        itemLabelled: item.label !== null,
        ...extra,
      },
    });
  }

  /** The open Décisions of the earlier StepRuns of `passed`'s Étape in its PhaseRun, resolved `passed`. */
  private async resolveEarlier(tx: Tx, passed: StepRun): Promise<void> {
    const earlier = await tx.stepRun.findMany({ where: { phaseRunId: passed.phaseRunId, stepId: passed.stepId, id: { not: passed.id } }, select: { id: true } });
    if (earlier.length === 0) return;
    const open = await tx.decision.findMany({
      where: { kind: { in: [...STEP_DECISION_KINDS] }, subjectId: { in: earlier.map((run) => run.id) }, state: 'open' },
      select: { kind: true, subjectId: true },
    });
    for (const decision of open) await this.decisions.resolve(tx, decision.kind as DecisionKind, decision.subjectId, 'passed');
  }
}
