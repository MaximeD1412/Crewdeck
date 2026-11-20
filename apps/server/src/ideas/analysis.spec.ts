import { type IdeaAnalysisRun, PROCESS_CREWDECK, type Step, type Verdict } from '@crewdeck/contracts';
import type { DecisionsService } from '../decisions/decisions.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { Engine } from '../process/engine/engine.js';
import type { EventsWriter } from '../realtime/events.writer.js';
import type { Transactions, Tx } from '../realtime/transactions.js';
import { runInPilotScope } from '../scope/scope.context.js';
import { analysisOutcome, type FinishedAnalysis, IdeaAnalysis } from './analysis.js';

const TX = {} as Tx;
const PILOT_ID = '019a8f3c-2b4d-7e10-8a5b-6c7d8e9f0a7b';
const IDEA_ID = '019a8f3c-2b4d-7e10-8a5b-6c7d8e9f0b01';
const OTHER_IDEA_ID = '019a8f3c-2b4d-7e10-8a5b-6c7d8e9f0b02';
const PROJECT_ID = '019a8f3c-2b4d-7e10-8a5b-6c7d8e9f0a3d';
const STEP_RUN_ID = '019a8f3c-2b4d-7e10-8a5b-6c7d8e9f0a1b';
const AT = new Date('2026-11-20T09:00:00.000Z');
const SEALED = { key: 'k'.repeat(80), ciphertext: 'c'.repeat(120) };

const IDEE_STEPS = PROCESS_CREWDECK.steps.filter((step) => step.phaseId === 'ph-idee');
const verdict = (status: Verdict['status'], failedRuleIds: string[] = []): Verdict => ({ contractId: 'idea-analysis', version: 1, status, failedRuleIds, warningRuleIds: [] });
const RUNNING: IdeaAnalysisRun = {
  stepRunId: STEP_RUN_ID,
  status: 'running',
  role: 'idea',
  engine: 'claude-code',
  at: '2026-11-20T08:59:00.000Z',
  contractId: null,
  contractVersion: null,
  failedRuleIds: [],
};

describe('analysisOutcome', () => {
  const finishedOf = (overrides: Partial<FinishedAnalysis> = {}): FinishedAnalysis => ({
    ideaId: IDEA_ID,
    stepRun: { id: STEP_RUN_ID, contratVerdict: null },
    finished: { status: 'passed', verdict: verdict('passed') },
    state: 'analysing',
    before: RUNNING,
    pending: { stepRunId: STEP_RUN_ID, figures: { impact: 4, effort: 2, projectId: PROJECT_ID, duplicateIds: [OTHER_IDEA_ID, IDEA_ID] }, sealed: SEALED },
    at: AT,
    ...overrides,
  });

  it('applies the report of a passed StepRun: the Idée analysed, its figures, its Projet visé, its duplicates but itself', () => {
    expect(analysisOutcome(finishedOf())).toEqual({
      state: 'analysed',
      run: { ...RUNNING, status: 'passed', at: AT.toISOString(), contractId: 'idea-analysis', contractVersion: 1 },
      applied: { analysis: SEALED, impact: 4, effort: 2, targetProjectId: PROJECT_ID, targetIsNew: false, duplicateIds: [OTHER_IDEA_ID] },
    });
  });

  it('reads « nouveau » as a new Projet, with no Projet visé', () => {
    const outcome = analysisOutcome(finishedOf({ pending: { stepRunId: STEP_RUN_ID, figures: { impact: 1, effort: 5, projectId: 'nouveau', duplicateIds: [] }, sealed: SEALED } }));
    expect(outcome.applied).toMatchObject({ targetProjectId: null, targetIsNew: true });
  });

  it('leaves an incomplete one to triage, saying the rules that failed, applying nothing', () => {
    const outcome = analysisOutcome(finishedOf({ finished: { status: 'incomplete', verdict: verdict('incomplete', ['idea-analysis.report.schema']) } }));
    expect(outcome).toEqual({
      state: 'to-triage',
      run: { ...RUNNING, status: 'incomplete', at: AT.toISOString(), contractId: 'idea-analysis', contractVersion: 1, failedRuleIds: ['idea-analysis.report.schema'] },
      applied: null,
    });
  });

  it('leaves a failed Session to triage, its rules read from the StepRun’s verdict when the signal has none', () => {
    const outcome = analysisOutcome(finishedOf({ finished: { status: 'failed', failure: 'session-error' }, stepRun: { id: STEP_RUN_ID, contratVerdict: null }, pending: null }));
    expect(outcome).toMatchObject({ state: 'to-triage', run: { status: 'failed', contractId: null, failedRuleIds: [] }, applied: null });
  });

  it('says the failure of a StepRun that started no Session, its Moteur none whatever the run before it', () => {
    const before = { ...RUNNING, stepRunId: OTHER_IDEA_ID, status: 'passed' as const };
    const outcome = analysisOutcome(finishedOf({ finished: { status: 'failed', failure: 'no-engine' }, before, pending: null }));
    expect(outcome).toEqual({
      state: 'to-triage',
      run: { stepRunId: STEP_RUN_ID, status: 'failed', role: 'idea', engine: null, at: AT.toISOString(), contractId: null, contractVersion: null, failedRuleIds: [], failure: 'no-engine' },
      applied: null,
    });
  });

  it('applies no report of another StepRun, nor a passed StepRun that sent none', () => {
    expect(analysisOutcome(finishedOf({ pending: { stepRunId: OTHER_IDEA_ID, figures: { impact: 4, effort: 2, projectId: 'nouveau', duplicateIds: [] }, sealed: null } }))).toMatchObject({
      state: 'to-triage',
      applied: null,
    });
    expect(analysisOutcome(finishedOf({ pending: null }))).toMatchObject({ state: 'to-triage', run: { status: 'passed' }, applied: null });
  });

  it('keeps the state of an Idée triaged since, and the Rôle of a run it never saw as idea', () => {
    expect(analysisOutcome(finishedOf({ state: 'retained' }))).toMatchObject({ state: null, applied: { impact: 4 } });
    expect(analysisOutcome(finishedOf({ state: 'merged', finished: { status: 'incomplete' } }))).toMatchObject({ state: null, applied: null });
    expect(analysisOutcome(finishedOf({ before: null })).run).toMatchObject({ role: 'idea', engine: null });
  });
});

describe('IdeaAnalysis', () => {
  const engineOf = (admission: { phaseId: string; steps: Step[] } | null) => ({ admissionFor: vi.fn(() => Promise.resolve(admission)), admit: vi.fn(() => Promise.resolve()) });
  const analysisOf = ({ engine = engineOf(null), prisma = {} }: { engine?: ReturnType<typeof engineOf>; prisma?: unknown } = {}) =>
    new IdeaAnalysis(prisma as PrismaService, {} as Transactions, {} as EventsWriter, {} as DecisionsService, engine as unknown as Engine);
  const asPilot = <T>(fn: () => Promise<T>): Promise<T> => runInPilotScope(PILOT_ID, fn);

  describe('admit', () => {
    it('admits the Idée into the idea.noted Phase of its Projet’s Process, whatever the Rôles: the Process decides, never a setting', async () => {
      const engine = engineOf({ phaseId: 'ph-idee', steps: IDEE_STEPS });

      await asPilot(() => analysisOf({ engine }).admit(TX, IDEA_ID, PROJECT_ID));

      expect(engine.admissionFor).toHaveBeenCalledWith(TX, PROJECT_ID, 'idea.noted');
      expect(engine.admit).toHaveBeenCalledWith(TX, { projectId: PROJECT_ID, phaseId: 'ph-idee', item: { type: 'idea', id: IDEA_ID } });
    });

    it('admits an Idée without a Projet into « Process Crewdeck »’s', async () => {
      const engine = engineOf({ phaseId: 'ph-idee', steps: IDEE_STEPS });

      await asPilot(() => analysisOf({ engine }).admit(TX, IDEA_ID, null));

      expect(engine.admissionFor).toHaveBeenCalledWith(TX, null, 'idea.noted');
      expect(engine.admit).toHaveBeenCalledWith(TX, { projectId: null, phaseId: 'ph-idee', item: { type: 'idea', id: IDEA_ID } });
    });

    it('admits nothing for a Process without an idea.noted Phase', async () => {
      const none = engineOf(null);
      await asPilot(() => analysisOf({ engine: none }).admit(TX, IDEA_ID, PROJECT_ID));
      expect(none.admit).not.toHaveBeenCalled();
    });
  });

  describe('projectsWaiting', () => {
    it('counts the analyses waiting to start by Projet, « Idées » for those of none, « Projet local » for a name it cannot read', async () => {
      const findMany = vi.fn(() =>
        Promise.resolve([
          { projectId: PROJECT_ID, project: { displayName: 'factures', name: 'factures-repo' } },
          { projectId: null, project: null },
          { projectId: PROJECT_ID, project: { displayName: 'factures', name: 'factures-repo' } },
          { projectId: OTHER_IDEA_ID, project: { displayName: null, name: null } },
        ]),
      );

      const waiting = await analysisOf({ prisma: { scoped: { agentSession: { findMany } } } }).projectsWaiting();

      expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { state: 'starting', stepKind: 'idea-analysis' } }));
      expect(waiting).toEqual([
        { projectId: PROJECT_ID, name: 'factures', items: [{ kind: 'ideas-waiting', count: 2 }] },
        { projectId: null, name: 'Idées', items: [{ kind: 'ideas-waiting', count: 1 }] },
        { projectId: OTHER_IDEA_ID, name: 'Projet local', items: [{ kind: 'ideas-waiting', count: 1 }] },
      ]);
    });
  });
});
