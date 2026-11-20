import { type PhaseRun, PROCESS_CREWDECK, type Step, type StepRun, zIdeaAnalysisFigures } from '@crewdeck/contracts';
import type { PinoLogger } from 'nestjs-pino';
import type { IdeaAnalysis } from '../../../ideas/analysis.js';
import type { Tx } from '../../../realtime/transactions.js';
import { RunnerWaitingWork } from '../../../runners/waiting-work.js';
import { PhaseItemHandlers } from '../items.js';
import type { AgentKindSpec, AgentSteps, StepReportHandler } from './agent.js';
import { StepKindHandlers, type StepRunContext } from './handler.js';
import { IdeaAnalysisKind } from './idea-analysis.js';
import { StepRunHooks } from './step-run-hooks.js';

const IDEA_ID = '019a8f3c-2b4d-7e10-8a5b-6c7d8e9f0b01';
const STEP_RUN_ID = '019a8f3c-2b4d-7e10-8a5b-6c7d8e9f0a1b';
const TEXT = { key: 'k'.repeat(80), ciphertext: 'c'.repeat(120) };
const ANALYSE = PROCESS_CREWDECK.steps.find((step) => step.kind === 'idea-analysis') as Step;

const runOf = (step: Step = ANALYSE): StepRunContext => ({
  phaseRun: { id: '019a8f3c-2b4d-7e10-8a5b-6c7d8e9f0a4e', projectId: null, itemType: 'idea', itemId: IDEA_ID } as PhaseRun,
  stepRun: { id: STEP_RUN_ID, kind: 'idea-analysis' } as StepRun,
  step,
  definition: PROCESS_CREWDECK,
});

/** The kind wired on fakes of the agent steps and the domain part, with the real registries. */
const wired = () => {
  const calls: string[] = [];
  let spec: AgentKindSpec | undefined;
  let report: { schema: unknown; handler: StepReportHandler<unknown> } | undefined;
  const steps = {
    defineAgentKind: (given: AgentKindSpec) => {
      spec = given;
      return {
        kind: given.kind,
        start: () => {
          calls.push('agent.start');
          return Promise.resolve('running' as const);
        },
        onSignal: () => Promise.resolve(null),
      };
    },
    registerStepReport: (_kind: string, schema: unknown, handler: StepReportHandler<unknown>) => {
      report = { schema, handler };
    },
  };
  const analysis = {
    started: vi.fn(() => {
      calls.push('analysis.started');
      return Promise.resolve();
    }),
    reported: vi.fn(() => Promise.resolve()),
    finished: vi.fn(() => Promise.resolve()),
    stopped: vi.fn(() => Promise.resolve()),
    context: vi.fn(() => Promise.resolve({ idea: { id: IDEA_ID, number: 3, text: TEXT, analysis: null }, open: [] })),
    projectsWaiting: vi.fn(() => Promise.resolve([{ projectId: null, name: 'Idées', items: [{ kind: 'ideas-waiting' as const, count: 1 }] }])),
  };
  const logger = { info: vi.fn(), error: vi.fn() };
  const handlers = new StepKindHandlers();
  const items = new PhaseItemHandlers();
  const hooks = new StepRunHooks();
  const work = new RunnerWaitingWork(logger as unknown as PinoLogger);
  const kind = new IdeaAnalysisKind(handlers, items, steps as unknown as AgentSteps, hooks, work, analysis as unknown as IdeaAnalysis, logger as unknown as PinoLogger);
  kind.onModuleInit();
  const tx = { idea: { findUnique: vi.fn(() => Promise.resolve({ number: 3 })), findUniqueOrThrow: vi.fn(() => Promise.resolve({ text: TEXT })) } } as unknown as Tx;
  return { kind, calls, spec: () => spec as AgentKindSpec, report: () => report, analysis, logger, handlers, items, hooks, work, tx };
};

describe('the idea-analysis kind', () => {
  it('is an agent Étape in a scratch folder, titled by the Idée’s sealed text, giving the Idée on its idea Sortie', async () => {
    const { spec, tx } = wired();
    const run = runOf();

    expect(spec()).toMatchObject({ kind: 'idea-analysis', waitingWork: 'own' });
    expect(await spec().branch(tx, run)).toBeNull();
    expect(await spec().title(tx, run)).toEqual({ ...TEXT, aad: `${IDEA_ID}:text` });
    expect(await spec().outputs(tx, run)).toEqual([{ portId: 'idee', type: 'idea', id: IDEA_ID }]);
    const renamed: Step = { ...ANALYSE, outputs: [{ id: 'idee-analysee', type: 'idea' }] };
    expect(await spec().outputs(tx, runOf(renamed))).toEqual([{ portId: 'idee-analysee', type: 'idea', id: IDEA_ID }]);
  });

  it('gives its Session the Idée and the other open Idées', async () => {
    const { spec, analysis, tx } = wired();

    expect(await spec().stepContext?.(tx, runOf())).toEqual({ ideas: { idea: { id: IDEA_ID, number: 3, text: TEXT, analysis: null }, open: [] } });
    expect(analysis.context).toHaveBeenCalledWith(tx, IDEA_ID);
  });

  it('starts the agent’s Session, then sets the Idée analysing', async () => {
    const { handlers, calls, analysis, tx } = wired();
    const run = runOf();

    expect(await handlers.of('idea-analysis')?.start(tx, run)).toBe('running');

    expect(calls).toEqual(['agent.start', 'analysis.started']);
    expect(analysis.started).toHaveBeenCalledWith(tx, run);
  });

  it('keeps a report of the figures’ schema, logging its ids only', async () => {
    const { report, analysis, logger, tx } = wired();
    const run = runOf();
    const given = { figures: { impact: 4, effort: 2, projectId: 'nouveau', duplicateIds: [] }, sealed: TEXT };

    expect(report()?.schema).toBe(zIdeaAnalysisFigures);
    await report()?.handler(tx, run, given);

    expect(analysis.reported).toHaveBeenCalledWith(tx, run, given);
    expect(logger.info).toHaveBeenCalledWith({ stepRunId: STEP_RUN_ID, ideaId: IDEA_ID }, 'idea analysis reported');
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain(TEXT.ciphertext);
  });

  it('applies the end of its own StepRuns only', async () => {
    const { hooks, analysis, tx } = wired();
    const own = { id: STEP_RUN_ID, kind: 'idea-analysis' } as StepRun;

    await hooks.finished(tx, own, { status: 'passed' });
    await hooks.finished(tx, { ...own, kind: 'code' }, { status: 'passed' });

    expect(analysis.finished).toHaveBeenCalledExactlyOnceWith(tx, own, { status: 'passed' });
  });

  it('names its item « Idée #n », opens /idees/<id>, and leaves it to triage when its PhaseRun is stopped', async () => {
    const { items, analysis, tx } = wired();
    const phaseRun = runOf().phaseRun;

    expect(await items.describe(tx, phaseRun)).toEqual({ label: 'Idée #3', link: `/idees/${IDEA_ID}` });
    await items.stopped(tx, phaseRun);
    expect(analysis.stopped).toHaveBeenCalledWith(tx, IDEA_ID);
  });

  it('lists its waiting analyses in « Runner hors ligne », until the module stops', async () => {
    const { kind, work, hooks, analysis, tx } = wired();

    expect(await work.collect('pilot')).toEqual([{ projectId: null, name: 'Idées', items: [{ kind: 'ideas-waiting', count: 1 }] }]);
    kind.onModuleDestroy();

    expect(await work.collect('pilot')).toEqual([]);
    await hooks.finished(tx, { id: STEP_RUN_ID, kind: 'idea-analysis' } as StepRun, { status: 'passed' });
    expect(analysis.finished).not.toHaveBeenCalled();
  });
});
