import { type ArtifactRef, type StepRunInput, type Verdict } from '@crewdeck/contracts';
import { Prisma } from '../../generated/prisma/client.js';
import { newId } from '../../ids.js';
import { PROJECTS, seedDecisions } from './a-toi.js';
import { defineScenario, type ScenarioContext } from './define.js';
import { seedRepositories } from './projets.js';

const MINUTE = 60_000;
const json = (value: unknown): Prisma.InputJsonValue => value as Prisma.InputJsonValue;
const input = (portId: string, artifacts: ArtifactRef[]): StepRunInput => ({ portId, artifacts, absent: false });

interface Failed {
  readonly ticket: string;
  /** The Étape that failed, after those before it in « Développement », done. */
  readonly stepId: 'st-code' | 'st-review';
  readonly stepName: string;
  readonly failure: 'contract-incomplete' | 'session-error';
  readonly verdict: Verdict | null;
  readonly kind: 'contract-incomplete' | 'step-failed';
  readonly params: Readonly<Record<string, string | number>>;
  /** How long its Décision has waited, in minutes. */
  readonly age: number;
}

/**
 * A Ticket of Site mairie in « Développement » as the engine leaves it once
 * an Étape failed: the PhaseRun `failed`, the Étape's first iteration
 * `failed` with its failure (and its Contrat's verdict), the Étapes before it
 * done. Its Décision as `StepDecisions` raises it, without a Tickets' module
 * (BOUCLE-2): the Étape's name, the Phase, the Projet's page.
 */
const seedFailed = async (ctx: ScenarioContext, pilotId: string, versionId: string, failed: Failed): Promise<void> => {
  const { projectId, projectName } = PROJECTS.siteMairie;
  const raisedAt = new Date(Date.now() - failed.age * MINUTE);
  const phaseRunId = newId();
  await ctx.prisma.unscoped.phaseRun.create({
    data: { id: phaseRunId, pilotId, projectId, processVersionId: versionId, phaseId: 'ph-dev', itemType: 'ticket', itemId: failed.ticket, state: 'failed', startedAt: new Date(raisedAt.getTime() - 60 * MINUTE) },
  });
  const change: ArtifactRef = { portId: 'changement', type: 'code-change', id: failed.ticket, sha: 'a'.repeat(40) };
  const checks: ArtifactRef = { portId: 'verdict', type: 'verdict', id: 'st-checks-1' };
  const ticketInput = input('ticket', [{ portId: 'document', type: 'ticket', id: failed.ticket }]);
  const run = (stepId: string, kind: string, inputs: StepRunInput[], outputs: ArtifactRef[], minutesBefore: number) => ({
    id: newId(),
    pilotId,
    projectId,
    phaseRunId,
    stepId,
    kind,
    iteration: 1,
    state: 'done' as const,
    inputs: json(inputs),
    outputs: json(outputs),
    startedAt: new Date(raisedAt.getTime() - (minutesBefore + 5) * MINUTE),
    endedAt: new Date(raisedAt.getTime() - minutesBefore * MINUTE),
  });
  const stepRunId = newId();
  const failedRun = {
    ...(failed.stepId === 'st-code'
      ? run('st-code', 'code', [ticketInput], [], 0)
      : run('st-review', 'review', [input('changement', [change]), input('verdict', [checks])], [], 0)),
    id: stepRunId,
    state: 'failed' as const,
    failure: failed.failure,
    contratVerdict: failed.verdict === null ? Prisma.DbNull : json(failed.verdict),
  };
  const before = failed.stepId === 'st-code' ? [] : [run('st-code', 'code', [ticketInput], [change], 20), run('st-checks', 'checks', [input('changement', [change])], [checks], 10)];
  await ctx.prisma.unscoped.stepRun.createMany({ data: [...before, failedRun] });
  await ctx.prisma.unscoped.decision.create({
    data: {
      id: newId(),
      pilotId,
      kind: failed.kind,
      projectId,
      projectName,
      subjectType: 'step-run',
      subjectId: stepRunId,
      label: failed.stepName,
      metaParts: ['Développement'],
      tone: 'caution',
      link: `/projets/${projectId}`,
      params: { stepRunId, phaseRunId, stepId: failed.stepId, itemType: 'ticket', itemId: failed.ticket, itemLabelled: false, ...failed.params },
      createdAt: raisedAt,
    },
  });
};

/**
 * « À toi » with the Décisions of an Étape (ATOI-2): the nine Décisions of
 * `a-toi`, « Contrat incomplet » for « Code » of #57 of Site mairie (its
 * tests and lint failed, 25 min ago) and « Étape échouée » for « Review » of
 * #58 (its Session ended in error, 30 min ago), each offering « Relancer
 * l’Étape » and « Voir ».
 */
export const aToiEtape = defineScenario({
  name: 'a-toi-etape',
  path: '/a-toi',
  seed: async (ctx) => {
    const seed = await seedDecisions(ctx);
    const { projectId, projectName } = PROJECTS.siteMairie;
    await seedRepositories(ctx, seed.pilotId, [{ name: 'site-mairie', hasCode: true, project: projectName, projectId }]);
    const version = await ctx.prisma.unscoped.processVersion.findFirstOrThrow({ where: { pilotId: seed.pilotId, projectId }, select: { id: true } });
    await seedFailed(ctx, seed.pilotId, version.id, {
      ticket: '57',
      stepId: 'st-code',
      stepName: 'Code',
      failure: 'contract-incomplete',
      verdict: { contractId: 'code', version: 1, status: 'incomplete', failedRuleIds: ['code.tests', 'code.lint'], warningRuleIds: [], headSha: 'b'.repeat(40) },
      kind: 'contract-incomplete',
      params: { contractId: 'code', contractVersion: 1, failedRuleIds: 'code.tests,code.lint', failedCount: 2 },
      age: 25,
    });
    await seedFailed(ctx, seed.pilotId, version.id, {
      ticket: '58',
      stepId: 'st-review',
      stepName: 'Review',
      failure: 'session-error',
      verdict: null,
      kind: 'step-failed',
      params: { failure: 'session-error' },
      age: 30,
    });
    return seed;
  },
});
