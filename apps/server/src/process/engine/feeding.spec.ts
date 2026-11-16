import { type ArtifactRef, PROCESS_CREWDECK, type StepRunState } from '@crewdeck/contracts';
import { currentStepRuns, type FeedingStepRun, reachedFrom, readySteps } from './feeding.js';

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
    expect(ready([])).toEqual([{ stepId: 'st-code', inputs: [{ portId: 'ticket', artifacts: [TICKET] }] }]);
  });

  it('starts nothing again while st-code runs', () => {
    expect(readyIds([run('st-code', 'running')])).toEqual([]);
  });

  it('starts st-checks and st-rv once st-code is done with a change; st-rv’s Maquettes from another Phase resolve with no Artefact', () => {
    const steps = ready([run('st-code', 'done', [CHANGE])]);

    expect(steps).toEqual([
      { stepId: 'st-checks', inputs: [{ portId: 'changement', artifacts: [CHANGE] }] },
      {
        stepId: 'st-rv',
        inputs: [
          { portId: 'changement', artifacts: [CHANGE] },
          { portId: 'maquettes', artifacts: [] },
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
          { portId: 'changement', artifacts: [CHANGE] },
          { portId: 'verdict', artifacts: [verdict('v-checks')] },
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
          { portId: 'changement', artifacts: [CHANGE] },
          { portId: 'v-review', artifacts: [verdict('v-review')] },
          { portId: 'v-rv', artifacts: [verdict('v-rv')] },
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
      { portId: 'changement', artifacts: [NEW_CHANGE] },
      { portId: 'changement', artifacts: [NEW_CHANGE] },
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
