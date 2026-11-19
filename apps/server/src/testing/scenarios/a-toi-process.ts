import { type ArtifactRef, PROCESS_CREWDECK, type PhaseRunLoopBack, type StepRunInput } from '@crewdeck/contracts';
import { Prisma } from '../../generated/prisma/client.js';
import { newId } from '../../ids.js';
import { PROJECTS, seedDecisions } from './a-toi.js';
import { defineScenario, type ScenarioContext } from './define.js';
import { seedRepositories } from './projets.js';

const MINUTE = 60_000;
const TICKET = '57';
const json = (value: unknown): Prisma.InputJsonValue => value as Prisma.InputJsonValue;

const CHANGE: ArtifactRef = { portId: 'changement', type: 'code-change', id: TICKET, sha: 'a'.repeat(40) };
const verdict = (stepId: string): ArtifactRef => ({ portId: 'verdict', type: 'verdict', id: `${stepId}-4` });
const input = (portId: string, artifacts: ArtifactRef[]): StepRunInput => ({ portId, artifacts, absent: false });

/**
 * #57 of Site mairie as the engine leaves it after its Review asked for
 * changes a 4th time, its Retour to « Code » (max 3) taken 3 times: the
 * PhaseRun waiting on « Maximum de Retours atteint », its Étapes' 4th
 * iteration done. The Décision as `Engine` raises it, the label as the
 * Tickets' module gives it (`#57 Recherche d’actes`).
 */
const seedExhausted = async (ctx: ScenarioContext, pilotId: string, raisedAt: Date): Promise<void> => {
  const { projectId, projectName } = PROJECTS.siteMairie;
  await seedRepositories(ctx, pilotId, [{ name: 'site-mairie', hasCode: true, project: projectName, projectId }]);
  const version = await ctx.prisma.unscoped.processVersion.findFirstOrThrow({ where: { pilotId, projectId }, select: { id: true } });
  const loopBack = PROCESS_CREWDECK.loopBacks.find(({ from }) => from === 'st-review');
  if (!loopBack) throw new Error('« Process Crewdeck » n’a plus de Retour depuis st-review');
  const loopBacks: PhaseRunLoopBack[] = [{ from: loopBack.from, to: loopBack.to, taken: loopBack.max, extra: 0 }];
  const phaseRunId = newId();
  const startedAt = new Date(raisedAt.getTime() - 90 * MINUTE);
  await ctx.prisma.unscoped.phaseRun.create({
    data: {
      id: phaseRunId,
      pilotId,
      projectId,
      processVersionId: version.id,
      phaseId: 'ph-dev',
      itemType: 'ticket',
      itemId: TICKET,
      state: 'waiting',
      waitingOn: 'decision',
      startedAt,
      loopBacks: json(loopBacks),
    },
  });
  const iteration = loopBack.max + 1;
  const done = (stepId: string, kind: string, inputs: StepRunInput[], outputs: ArtifactRef[], verdictOf: 'passed' | 'changes' | null, minutesBefore: number) => ({
    id: newId(),
    pilotId,
    projectId,
    phaseRunId,
    stepId,
    kind,
    iteration,
    state: 'done' as const,
    inputs: json(inputs),
    outputs: json(outputs),
    verdict: verdictOf,
    reason: stepId === loopBack.to ? 'loop-back' : null,
    startedAt: new Date(raisedAt.getTime() - (minutesBefore + 5) * MINUTE),
    endedAt: new Date(raisedAt.getTime() - minutesBefore * MINUTE),
  });
  await ctx.prisma.unscoped.stepRun.createMany({
    data: [
      done('st-code', 'code', [input('ticket', [{ portId: 'document', type: 'ticket', id: TICKET }])], [CHANGE], null, 20),
      done('st-checks', 'checks', [input('changement', [CHANGE])], [verdict('st-checks')], 'passed', 10),
      done('st-review', 'review', [input('changement', [CHANGE]), input('verdict', [verdict('st-checks')])], [verdict('st-review')], 'changes', 0),
    ],
  });
  const stepRun = await ctx.prisma.unscoped.stepRun.findFirstOrThrow({ where: { phaseRunId, stepId: 'st-review' }, select: { id: true } });
  await ctx.prisma.unscoped.decision.create({
    data: {
      id: newId(),
      pilotId,
      kind: 'loop-back.exhausted',
      projectId,
      projectName,
      subjectType: 'phase-run',
      subjectId: phaseRunId,
      label: `#${TICKET} Recherche d’actes`,
      metaParts: ['Review'],
      tone: 'caution',
      link: '/a-toi',
      params: {
        phaseRunId,
        itemType: 'ticket',
        stepRunId: stepRun.id,
        stepName: 'Review',
        targetName: 'Code',
        taken: loopBack.max,
        max: loopBack.max,
        canContinue: true,
        sessionId: null,
      },
      createdAt: raisedAt,
    },
  });
};

/**
 * « À toi » with the Process's Décisions (`design/screens.json`: `a-toi`,
 * state `process`): the nine Décisions of `a-toi`, and « Maximum de Retours
 * atteint » for #57 of Site mairie, raised 25 min ago, which offers
 * « Encore un passage » and « Arrêter ».
 */
export const aToiProcess = defineScenario({
  name: 'a-toi-process',
  path: '/a-toi',
  seed: async (ctx) => {
    const seed = await seedDecisions(ctx);
    await seedExhausted(ctx, seed.pilotId, new Date(Date.now() - 25 * MINUTE));
    return seed;
  },
});
