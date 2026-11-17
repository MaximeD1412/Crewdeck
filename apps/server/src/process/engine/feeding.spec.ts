import { type ArtifactRef, PROCESS_CREWDECK, type ProcessDefinition, type StepRunState } from '@crewdeck/contracts';
import { type Ancestor, currentStepRuns, type FeedingStepRun, reachedFrom, readySteps } from './feeding.js';

/** A Ticket through « Développement » of « Process Crewdeck ». */
const RUN = { phaseId: 'ph-dev', itemType: 'ticket', itemId: '42' } as const;
const TICKET: ArtifactRef = { portId: 'ticket', type: 'ticket', id: '42' };
const CHANGE: ArtifactRef = { portId: 'changement', type: 'code-change', id: '57', sha: 'a'.repeat(40) };
const NEW_CHANGE: ArtifactRef = { ...CHANGE, sha: 'b'.repeat(40) };
const verdict = (id: string): ArtifactRef => ({ portId: 'verdict', type: 'verdict', id });

let ids = 0;
const run = (stepId: string, state: StepRunState, outputs: ArtifactRef[] = [], iteration = 1): FeedingStepRun => ({
  id: `019a6f00-0000-7000-8000-${String(++ids).padStart(12, '0')}`,
  stepId,
  state,
  iteration,
  outputs,
});

const ready = (stepRuns: FeedingStepRun[]) => readySteps(PROCESS_CREWDECK, RUN, stepRuns);
const readyIds = (stepRuns: FeedingStepRun[]) => ready(stepRuns).map((step) => step.stepId);

describe('readySteps on « Développement » of « Process Crewdeck »', () => {
  it('feeds st-code with the item: its Entrée comes from another Phase, of the Phase’s forEach type', () => {
    expect(ready([])).toEqual([{ stepId: 'st-code', inputs: [{ portId: 'ticket', artifacts: [TICKET], absent: false }] }]);
  });

  it('starts nothing again while st-code runs', () => {
    expect(readyIds([run('st-code', 'running')])).toEqual([]);
  });

  it('starts st-checks and st-rv once st-code is done with a change; with no ancestor, st-rv’s Maquettes from another Phase are absent and it starts', () => {
    const steps = ready([run('st-code', 'done', [CHANGE])]);

    expect(steps).toEqual([
      { stepId: 'st-checks', inputs: [{ portId: 'changement', artifacts: [CHANGE], absent: false }] },
      {
        stepId: 'st-rv',
        inputs: [
          { portId: 'changement', artifacts: [CHANGE], absent: false },
          { portId: 'maquettes', artifacts: [], absent: true },
        ],
      },
    ]);
  });

  it('starts st-review once the checks’ Verdict exists', () => {
    const steps = ready([run('st-code', 'done', [CHANGE]), run('st-checks', 'done', [verdict('v-checks')]), run('st-rv', 'running')]);

    expect(steps).toEqual([
      {
        stepId: 'st-review',
        inputs: [
          { portId: 'changement', artifacts: [CHANGE], absent: false },
          { portId: 'verdict', artifacts: [verdict('v-checks')], absent: false },
        ],
      },
    ]);
  });

  it('starts st-merge only once both Verdicts and the change are there', () => {
    const before = [run('st-code', 'done', [CHANGE]), run('st-checks', 'done', [verdict('v-checks')]), run('st-review', 'done', [verdict('v-review')])];
    expect(readyIds([...before, run('st-rv', 'waiting')])).toEqual([]);

    expect(ready([...before, run('st-rv', 'done', [verdict('v-rv')])])).toEqual([
      {
        stepId: 'st-merge',
        inputs: [
          { portId: 'changement', artifacts: [CHANGE], absent: false },
          { portId: 'v-review', artifacts: [verdict('v-review')], absent: false },
          { portId: 'v-rv', artifacts: [verdict('v-rv')], absent: false },
        ],
      },
    ]);
  });

  it('never starts an Étape whose predecessor is done without an output on that Sortie', () => {
    expect(readyIds([run('st-code', 'done', [])])).toEqual([]);
    expect(readyIds([run('st-code', 'done', [{ ...CHANGE, portId: 'autre' }])])).toEqual([]);
  });

  it('never starts again an Étape that failed or was stopped: a failed one waits for retry', () => {
    expect(readyIds([run('st-code', 'failed')])).toEqual([]);
    expect(readyIds([run('st-code', 'stopped')])).toEqual([]);
  });

  it('ignores superseded StepRuns: the Étape is ready again, fed by the latest done StepRun that is not superseded', () => {
    const superseded = [run('st-code', 'superseded', [CHANGE]), run('st-checks', 'superseded', [verdict('v-old')])];
    expect(readyIds(superseded)).toEqual(['st-code']);

    expect(ready([...superseded, run('st-code', 'done', [NEW_CHANGE], 2)]).map((step) => step.inputs[0])).toEqual([
      { portId: 'changement', artifacts: [NEW_CHANGE], absent: false },
      { portId: 'changement', artifacts: [NEW_CHANGE], absent: false },
    ]);
  });
});

describe('reachedFrom', () => {
  it('is the Étape and every Étape it reaches by arrows inside its Phase', () => {
    expect(reachedFrom(PROCESS_CREWDECK, 'st-code')).toEqual(['st-code', 'st-checks', 'st-review', 'st-rv', 'st-merge']);
    expect(reachedFrom(PROCESS_CREWDECK, 'st-checks')).toEqual(['st-checks', 'st-review', 'st-merge']);
    expect(reachedFrom(PROCESS_CREWDECK, 'st-merge')).toEqual(['st-merge']);
  });

  it('stops at the Phase’s edge: « Validation des Tickets » reaches nothing of « Développement »', () => {
    expect(reachedFrom(PROCESS_CREWDECK, 'st-ap-tickets')).toEqual(['st-ap-tickets']);
  });
});

describe('currentStepRuns', () => {
  it('keeps the latest StepRun of each Étape that is not superseded: a retried Étape’s failed one no longer counts', () => {
    const failed = run('st-code', 'failed');
    const retried = run('st-code', 'running');
    const superseded = run('st-checks', 'superseded');

    expect(currentStepRuns([failed, superseded, retried])).toEqual([retried]);
    expect(currentStepRuns([failed])).toEqual([failed]);
  });
});

describe('readySteps across Phases of « Process Crewdeck »: lineage', () => {
  const MOCKUPS = (sha: string): ArtifactRef => ({ portId: 'document', type: 'mockups', id: 'design/screens', sha: sha.repeat(40) });
  /** A Conception that approved `mockups`, the Ticket's parent. */
  const conception = (id: string, mockups: ArtifactRef): Ancestor => ({
    id,
    stepRuns: [run('st-maquettes', 'done', [{ ...mockups, portId: 'maquettes', sha: 'f'.repeat(40) }]), run('st-ap-maquettes', 'done', [mockups])],
  });
  const rv = (ancestors: Ancestor[]) => readySteps(PROCESS_CREWDECK, RUN, [run('st-code', 'done', [CHANGE])], ancestors).find((step) => step.stepId === 'st-rv');

  it('feeds st-rv.maquettes with the Maquettes its parent Conception approved, with their SHA', () => {
    expect(rv([conception('c-1', MOCKUPS('c'))])?.inputs).toEqual([
      { portId: 'changement', artifacts: [CHANGE], absent: false },
      { portId: 'maquettes', artifacts: [MOCKUPS('c')], absent: false },
    ]);
  });

  it('gives each Ticket its own Conception’s Maquettes, never another’s', () => {
    expect(rv([conception('c-1', MOCKUPS('1'))])?.inputs[1]?.artifacts).toEqual([MOCKUPS('1')]);
    expect(rv([conception('c-2', MOCKUPS('2'))])?.inputs[1]?.artifacts).toEqual([MOCKUPS('2')]);
  });

  it('reads the nearest ancestor that ran the Étape: past a parent that did not, the latest done StepRun not superseded', () => {
    const idea: Ancestor = { id: 'i-1', stepRuns: [run('st-tri', 'done', [{ portId: 'idee', type: 'idea', id: 'idee-1' }])] };
    const reapproved: Ancestor = {
      id: 'c-1',
      stepRuns: [run('st-ap-maquettes', 'done', [MOCKUPS('1')]), run('st-ap-maquettes', 'done', [MOCKUPS('2')], 2), run('st-ap-maquettes', 'superseded', [MOCKUPS('3')], 3)],
    };
    const ticketOfTicket: Ancestor = { id: 't-1', stepRuns: [run('st-code', 'done', [CHANGE])] };

    expect(rv([ticketOfTicket, reapproved, idea])?.inputs[1]).toEqual({ portId: 'maquettes', artifacts: [MOCKUPS('2')], absent: false });
  });

  it('makes st-rv.maquettes absent when no ancestor approved Maquettes, and st-rv starts all the same', () => {
    const noMockups: Ancestor = { id: 'c-1', stepRuns: [run('st-ap-maquettes', 'running')] };

    expect(rv([noMockups])?.inputs[1]).toEqual({ portId: 'maquettes', artifacts: [], absent: true });
    expect(rv([])?.inputs[1]).toEqual({ portId: 'maquettes', artifacts: [], absent: true });
  });
});

describe('readySteps of a Phase without forEach', () => {
  const MERGED: ArtifactRef = { ...CHANGE, sha: 'd'.repeat(40) };
  const LIVRAISON: ProcessDefinition = {
    ...PROCESS_CREWDECK,
    phases: [...PROCESS_CREWDECK.phases, { id: 'ph-livraison', name: 'Livraison', col: 1, row: 4, forEach: null }],
    steps: [
      ...PROCESS_CREWDECK.steps,
      { id: 'st-lancer', phaseId: 'ph-livraison', kind: 'command', name: 'Lancer', col: 1, row: 1, inputs: [{ id: 'changement', type: 'code-change' }], outputs: [], tools: [] },
    ],
    arrows: [...PROCESS_CREWDECK.arrows, { from: { stepId: 'st-merge', portId: 'changement' }, to: { stepId: 'st-lancer', portId: 'changement' } }],
  };

  it('feeds its first Entrée with its item from its parent: the merged change, with its SHA, not the other changes that Sortie gave', () => {
    const merge: Ancestor = { id: 'd-1', stepRuns: [run('st-merge', 'done', [MERGED, { ...MERGED, id: '58' }])] };

    expect(readySteps(LIVRAISON, { phaseId: 'ph-livraison', itemType: 'code-change', itemId: '57' }, [], [merge])).toEqual([
      { stepId: 'st-lancer', inputs: [{ portId: 'changement', artifacts: [MERGED], absent: false }] },
    ]);
  });
});
