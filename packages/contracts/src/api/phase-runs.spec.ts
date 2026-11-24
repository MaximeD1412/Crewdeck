import {
  eventPayloadSchema,
  type PhaseRun,
  RESOURCES,
  runningWorkByVersion,
  STATE_SLICES,
  type StepRun,
  zArtifactRef,
  zPhaseRun,
  zPhaseRunDecisionAnswer,
  zStepRun,
} from '../index.js';

const PROJECT = '019a6f00-0000-7000-8000-000000000011';
const AT = '2026-11-16T08:00:00.000Z';

const PHASE_RUN: PhaseRun = {
  id: '019a6f00-0000-7000-8000-000000000021',
  projectId: PROJECT,
  processVersion: 1,
  builtinTemplate: null,
  parentPhaseRunId: '019a6f00-0000-7000-8000-000000000022',
  phaseId: 'ph-dev',
  itemType: 'ticket',
  itemId: '42',
  state: 'running',
  waitingOn: null,
  loopBacks: [],
  startedAt: AT,
  endedAt: null,
};

const STEP_RUN: StepRun = {
  id: '019a6f00-0000-7000-8000-000000000031',
  projectId: PROJECT,
  phaseRunId: PHASE_RUN.id,
  stepId: 'st-merge',
  kind: 'merge',
  iteration: 1,
  state: 'done',
  inputs: [
    { portId: 'changement', artifacts: [{ portId: 'changement', type: 'code-change', id: '57', sha: 'a'.repeat(40) }], absent: false },
    { portId: 'v-review', artifacts: [{ portId: 'verdict', type: 'verdict', id: '019a6f00-0000-7000-8000-000000000032' }], absent: false },
  ],
  outputs: [{ portId: 'changement', type: 'code-change', id: '57', sha: 'b'.repeat(40) }],
  verdict: 'passed',
  failure: null,
  reason: null,
  sessionId: null,
  contratVerdict: null,
  canAskChanges: false,
  startedAt: AT,
  endedAt: AT,
};

const phaseRun = (processVersion: number | null, state: PhaseRun['state']): PhaseRun => ({ ...PHASE_RUN, processVersion, state });

describe('zPhaseRun and zStepRun', () => {
  it('are the payloads of phase-run.upserted and step-run.upserted, and the items of the phaseRuns and stepRuns slices', () => {
    expect(RESOURCES).toContain('phase-run');
    expect(eventPayloadSchema('phase-run.upserted')?.parse(PHASE_RUN)).toEqual(PHASE_RUN);
    expect(eventPayloadSchema('step-run.upserted')?.parse(STEP_RUN)).toEqual(STEP_RUN);
    expect(STATE_SLICES.phaseRuns.parse([PHASE_RUN])).toEqual([PHASE_RUN]);
    expect(STATE_SLICES.stepRuns.parse([STEP_RUN])).toEqual([STEP_RUN]);
  });

  it('refuses a PhaseRun on version 0, an unknown state, and a StepRun at iteration 0', () => {
    expect(zPhaseRun.safeParse({ ...PHASE_RUN, processVersion: 0 }).success).toBe(false);
    expect(zPhaseRun.safeParse({ ...PHASE_RUN, state: 'paused' }).success).toBe(false);
    expect(zPhaseRun.safeParse({ ...PHASE_RUN, state: 'waiting', waitingOn: 'decision' }).success).toBe(true);
    expect(zStepRun.safeParse({ ...STEP_RUN, iteration: 0 }).success).toBe(false);
    expect(zStepRun.safeParse({ ...STEP_RUN, verdict: 'maybe' }).success).toBe(false);
  });

  it('takes a PhaseRun without a Projet only on a builtin definition, with no version; and a builtin one only without a Projet', () => {
    const noted = { ...PHASE_RUN, projectId: null, processVersion: null, builtinTemplate: 'process-crewdeck', parentPhaseRunId: null, phaseId: 'ph-idee', itemType: 'idea' };
    expect(zPhaseRun.parse(noted)).toEqual(noted);
    expect(zStepRun.safeParse({ ...STEP_RUN, projectId: null }).success).toBe(true);

    expect(zPhaseRun.safeParse({ ...noted, builtinTemplate: null }).success).toBe(false);
    expect(zPhaseRun.safeParse({ ...noted, processVersion: 1 }).success).toBe(false);
    expect(zPhaseRun.safeParse({ ...PHASE_RUN, builtinTemplate: 'process-crewdeck' }).success).toBe(false);
    expect(zPhaseRun.safeParse({ ...noted, builtinTemplate: 'preparation' }).success).toBe(false);
  });

  it('takes a Projet’s PhaseRun on « Préparation », with no version: the Inventaire before its Process', () => {
    const preparing = { ...PHASE_RUN, processVersion: null, builtinTemplate: 'preparation', parentPhaseRunId: null, phaseId: 'ph-preparation', itemType: 'inventory' };
    expect(zPhaseRun.parse(preparing)).toEqual(preparing);

    expect(zPhaseRun.safeParse({ ...preparing, processVersion: 1 }).success).toBe(false);
    expect(zPhaseRun.safeParse({ ...preparing, projectId: null }).success).toBe(false);
  });

  it('counts the Retours a PhaseRun took and the passes the Pilote allowed beyond their maximum', () => {
    const counted = { ...PHASE_RUN, loopBacks: [{ from: 'st-review', to: 'st-code', taken: 3, extra: 1 }] };
    expect(zPhaseRun.parse(counted)).toEqual(counted);
    expect(zPhaseRun.safeParse({ ...PHASE_RUN, loopBacks: [{ from: 'st-review', to: 'st-code', taken: -1, extra: 0 }] }).success).toBe(false);
    expect(zPhaseRun.safeParse({ ...PHASE_RUN, loopBacks: undefined }).success).toBe(false);
  });

  it('says whether a StepRun may ask for changes', () => {
    expect(zStepRun.parse({ ...STEP_RUN, stepId: 'st-rv', kind: 'visual-review', canAskChanges: true }).canAskChanges).toBe(true);
    expect(zStepRun.safeParse({ ...STEP_RUN, canAskChanges: undefined }).success).toBe(false);
  });

  it('says of each Entrée whether it is absent', () => {
    expect(zStepRun.safeParse({ ...STEP_RUN, inputs: [{ portId: 'maquettes', artifacts: [], absent: true }] }).success).toBe(true);
    expect(zStepRun.safeParse({ ...STEP_RUN, inputs: [{ portId: 'maquettes', artifacts: [] }] }).success).toBe(false);
  });
});

describe('zPhaseRunDecisionAnswer', () => {
  it('is the body of one-more-pass and stop: the Décision answered, by its id, with the seq the page saw', () => {
    expect(zPhaseRunDecisionAnswer.parse({ decisionId: PHASE_RUN.id, seq: '12' })).toEqual({ decisionId: PHASE_RUN.id, seq: 12 });
    expect(zPhaseRunDecisionAnswer.safeParse({ decisionId: 'abc', seq: '12' }).success).toBe(false);
    expect(zPhaseRunDecisionAnswer.safeParse({ decisionId: PHASE_RUN.id }).success).toBe(false);
    expect(zPhaseRunDecisionAnswer.safeParse({}).success).toBe(false);
  });
});

describe('zArtifactRef', () => {
  it('is a reference, never content: an id of 1 to 200 characters, a SHA of 40 hexadecimal digits', () => {
    expect(zArtifactRef.safeParse({ portId: 'prd', type: 'prd', id: 'docs/product/prd.md' }).success).toBe(true);
    expect(zArtifactRef.safeParse({ portId: 'prd', type: 'prd', id: '' }).success).toBe(false);
    expect(zArtifactRef.safeParse({ portId: 'prd', type: 'prd', id: 'x'.repeat(201) }).success).toBe(false);
    expect(zArtifactRef.safeParse({ portId: 'changement', type: 'code-change', id: '57', sha: 'main' }).success).toBe(false);
    expect(zArtifactRef.safeParse({ portId: 'changement', type: 'film', id: '57' }).success).toBe(false);
  });
});

describe('runningWorkByVersion', () => {
  it('counts the running and waiting PhaseRuns by version, in the order of the versions', () => {
    expect(
      runningWorkByVersion([phaseRun(2, 'running'), phaseRun(1, 'waiting'), phaseRun(1, 'running'), phaseRun(1, 'done'), phaseRun(3, 'failed'), phaseRun(3, 'stopped')]),
    ).toEqual([
      { version: 1, count: 2 },
      { version: 2, count: 1 },
    ]);
  });

  it('is empty when nothing runs', () => {
    expect(runningWorkByVersion([])).toEqual([]);
    expect(runningWorkByVersion([phaseRun(1, 'done')])).toEqual([]);
  });

  it('counts no version for a PhaseRun without one: an Idée without a Projet', () => {
    expect(runningWorkByVersion([{ processVersion: null, state: 'running' }, phaseRun(1, 'running')])).toEqual([{ version: 1, count: 1 }]);
  });
});
