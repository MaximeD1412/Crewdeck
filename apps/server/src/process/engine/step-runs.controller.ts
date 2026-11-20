import { type StepRunRerunResult, zId, zStepRunRerun, zStepRunRerunResult } from '@crewdeck/contracts';
import { Body, Controller, HttpCode, Param, Post } from '@nestjs/common';
import { createZodDto, ZodResponse } from 'nestjs-zod';
import { DecisionsService } from '../../decisions/decisions.service.js';
import { notFound, unprocessable } from '../../errors/app-error.js';
import { MESSAGES } from '../../errors/messages.js';
import { EventsWriter } from '../../realtime/events.writer.js';
import { assertFresh } from '../../realtime/freshness.js';
import { Transactions } from '../../realtime/transactions.js';
import { currentPilotId } from '../../scope/scope.context.js';
import { Engine } from './engine.js';
import { RERUNNABLE_FAILURES, STEP_DECISION_KINDS } from './step-decisions.js';

export class StepRunRerunDto extends createZodDto(zStepRunRerun) {}
export class StepRunRerunResultDto extends createZodDto(zStepRunRerunResult) {}

const stepRunNotFound = () => notFound('step-run.not-found', MESSAGES['step-run.not-found']);
const notRerunnable = () => unprocessable('step.not-rerunnable', MESSAGES['step.not-rerunnable']);

/**
 * `/api/step-runs` (ATOI-2): « Relancer l'Étape », the answer of « Contrat
 * incomplet » and « Étape échouée ». 404 `step-run.not-found` for a StepRun
 * that is not the Pilote's, 422 `step.not-rerunnable` for one that did not
 * fail by its Contrat or its Session (or that the engine cannot retry any
 * more: its PhaseRun stopped, its Étape run again), 409
 * `decision.already-answered` once its Décision was answered, 409
 * `realtime.stale` when the StepRun changed since the `seq` the page saw.
 * The Runner offline, the new StepRun's Session waits for it (`starting`).
 */
@Controller('step-runs')
export class StepRunsController {
  constructor(
    private readonly transactions: Transactions,
    private readonly decisions: DecisionsService,
    private readonly events: EventsWriter,
    private readonly engine: Engine,
  ) {}

  /**
   * A new StepRun of the same Étape and iteration in the same PhaseRun
   * (`Engine.retry`), the PhaseRun going on from there, and the StepRun's
   * Décision resolved `rerun`, in one transaction. Read under the Pilote's
   * lock, the one the engine takes: of two clicks at once, the second reads
   * the Décision once the first committed, answered (409).
   */
  @Post(':id/rerun')
  @HttpCode(200)
  @ZodResponse({ status: 200, description: 'The new StepRun, or null while the start guard of its Phase holds it.', type: StepRunRerunResultDto })
  rerun(@Param('id') id: string, @Body() { seq }: StepRunRerunDto): Promise<StepRunRerunResult> {
    const parsed = zId.safeParse(id);
    if (!parsed.success) throw stepRunNotFound();
    const stepRunId = parsed.data;
    return this.transactions.run(async (tx) => {
      await this.events.lock(tx, currentPilotId());
      const stepRun = await tx.stepRun.findUnique({ where: { id: stepRunId }, select: { state: true, failure: true, lastSeq: true } });
      if (!stepRun) throw stepRunNotFound();
      if (stepRun.state !== 'failed' || stepRun.failure === null || !RERUNNABLE_FAILURES.has(stepRun.failure)) throw notRerunnable();
      const raised = await tx.decision.findFirst({
        where: { kind: { in: [...STEP_DECISION_KINDS] }, subjectId: stepRunId },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      });
      if (!raised) throw notFound('decision.not-found', MESSAGES['decision.not-found']);
      const decision = await this.decisions.assertOpen(tx, raised.id);
      assertFresh(stepRun.lastSeq, BigInt(seq));
      const restarted = await this.engine.retry(tx, stepRunId);
      if (restarted === null) throw notRerunnable();
      await this.decisions.resolve(tx, decision.kind, stepRunId, 'rerun');
      return { stepRun: restarted === 'held' ? null : restarted };
    });
  }
}
