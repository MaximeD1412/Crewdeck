import { type Decision, type PhaseRun, zId, zPhaseRun, zPhaseRunDecisionAnswer } from '@crewdeck/contracts';
import { Body, Controller, HttpCode, Inject, Param, Post } from '@nestjs/common';
import { createZodDto, ZodResponse } from 'nestjs-zod';
import { DecisionsService } from '../../decisions/decisions.service.js';
import { notFound, unprocessable } from '../../errors/app-error.js';
import { MESSAGES } from '../../errors/messages.js';
import { EventsWriter } from '../../realtime/events.writer.js';
import { assertFresh } from '../../realtime/freshness.js';
import { type Tx, Transactions } from '../../realtime/transactions.js';
import { currentPilotId } from '../../scope/scope.context.js';
import { Engine } from './engine.js';
import { PHASE_ITEMS, type PhaseItemHandlers } from './items.js';

export class PhaseRunDecisionAnswerDto extends createZodDto(zPhaseRunDecisionAnswer) {}
export class PhaseRunDto extends createZodDto(zPhaseRun) {}

const phaseRunNotFound = () => notFound('phase-run.not-found', MESSAGES['phase-run.not-found']);

const phaseRunId = (value: string): string => {
  const parsed = zId.safeParse(value);
  if (!parsed.success) throw phaseRunNotFound();
  return parsed.data;
};

/**
 * `/api/phase-runs`: the Pilote's answers to « Maximum de Retours atteint »
 * (PROCESS-6), each naming the open Décision `loop-back.exhausted` of the
 * PhaseRun it answers. 404 `phase-run.not-found` for a PhaseRun that is not
 * the Pilote's, 404 `decision.not-found` for a Décision that is not this
 * PhaseRun's, 409 `decision.already-answered` once it was answered, 409
 * `realtime.stale` when the PhaseRun changed since the `seq` the page saw.
 */
@Controller('phase-runs')
export class PhaseRunsController {
  constructor(
    private readonly transactions: Transactions,
    private readonly decisions: DecisionsService,
    private readonly events: EventsWriter,
    private readonly engine: Engine,
    @Inject(PHASE_ITEMS) private readonly items: PhaseItemHandlers,
  ) {}

  /** « Encore un passage »: the Retour that reached its maximum is taken once more. 422 `phase-run.no-loop-back` when no Retour leaves the Étape. */
  @Post(':id/one-more-pass')
  @HttpCode(200)
  @ZodResponse({ status: 200, description: 'The PhaseRun, running again from the Retour’s target.', type: PhaseRunDto })
  oneMorePass(@Param('id') id: string, @Body() { decisionId, seq }: PhaseRunDecisionAnswerDto): Promise<PhaseRun> {
    return this.transactions.run(async (tx) => {
      const decision = await this.openDecision(tx, phaseRunId(id), decisionId, BigInt(seq));
      const stepRunId = typeof decision.params.stepRunId === 'string' ? decision.params.stepRunId : '';
      const phaseRun = await this.engine.oneMorePass(tx, decision.subjectId, stepRunId);
      if (!phaseRun) throw unprocessable('phase-run.no-loop-back', MESSAGES['phase-run.no-loop-back']);
      return phaseRun;
    });
  }

  /** « Arrêter »: the PhaseRun stopped, its running StepRuns with it, and the item stopped by its module (`PHASE_ITEMS`). */
  @Post(':id/stop')
  @HttpCode(200)
  @ZodResponse({ status: 200, description: 'The PhaseRun, stopped.', type: PhaseRunDto })
  stop(@Param('id') id: string, @Body() { decisionId, seq }: PhaseRunDecisionAnswerDto): Promise<PhaseRun> {
    return this.transactions.run(async (tx) => {
      const decision = await this.openDecision(tx, phaseRunId(id), decisionId, BigInt(seq));
      const stopped = await this.engine.stop(tx, decision.subjectId);
      await this.items.stopped(tx, stopped);
      return stopped;
    });
  }

  /**
   * The open Décision `loop-back.exhausted` of the Pilote's PhaseRun `id`,
   * unchanged since `seq`. Read under the Pilote's lock, the one the engine
   * takes: of two answers at once, the second reads the Décision once the
   * first committed, answered (409).
   */
  private async openDecision(tx: Tx, id: string, decisionId: string, seq: bigint): Promise<Decision> {
    await this.events.lock(tx, currentPilotId());
    const phaseRun = await tx.phaseRun.findUnique({ where: { id }, select: { lastSeq: true } });
    if (!phaseRun) throw phaseRunNotFound();
    const decision = await this.decisions.assertOpen(tx, decisionId);
    if (decision.kind !== 'loop-back.exhausted' || decision.subjectId !== id) throw notFound('decision.not-found', MESSAGES['decision.not-found']);
    assertFresh(phaseRun.lastSeq, seq);
    return decision;
  }
}
