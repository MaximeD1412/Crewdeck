import { PROCESS_CASES } from '../../fixtures/process/cases.js';
import { defaultStep } from './catalogue.js';
import type { ProcessDefinition } from './definition.js';
import { diffDefinitions, PROCESS_CHANGE_KINDS } from './diff.js';
import { PROCESS_CREWDECK } from './templates/process-crewdeck.js';

/** « Process Crewdeck » with `edit` applied to a copy. */
const edited = (edit: (draft: ProcessDefinition) => void): ProcessDefinition => {
  const draft = structuredClone(PROCESS_CREWDECK);
  edit(draft);
  return draft;
};

const stepOf = (draft: ProcessDefinition, id: string) => {
  const step = draft.steps.find((candidate) => candidate.id === id);
  if (!step) throw new Error(`no Étape ${id}`);
  return step;
};
const phaseOf = (draft: ProcessDefinition, id: string) => {
  const phase = draft.phases.find((candidate) => candidate.id === id);
  if (!phase) throw new Error(`no Phase ${id}`);
  return phase;
};

describe('diffDefinitions', () => {
  it('gives nothing for two equal definitions, on every accepted fixture of fixtures/process/', () => {
    // As findGaps, it reads only what validateDefinition accepts: unique ids.
    for (const processCase of PROCESS_CASES.filter((candidate) => candidate.refusals.length === 0)) {
      expect(diffDefinitions(processCase.definition, structuredClone(processCase.definition)), processCase.name).toEqual([]);
    }
  });

  it('gives a Phase added and removed with its id and name, its Étapes, arrows and Retours folded into it', () => {
    const livraison = edited((draft) => {
      draft.phases.push({ id: 'ph-livraison', name: 'Livraison', col: 1, row: 4, forEach: null });
      draft.steps.push({ ...defaultStep('code', { id: 'st-deploy', phaseId: 'ph-livraison', col: 1, row: 1 }), name: 'Déploiement' });
      draft.arrows.push({ from: { stepId: 'st-merge', portId: 'changement' }, to: { stepId: 'st-deploy', portId: 'ticket' } });
    });
    expect(diffDefinitions(PROCESS_CREWDECK, livraison)).toEqual([{ kind: 'phase.added', phase: { id: 'ph-livraison', name: 'Livraison' } }]);
    expect(diffDefinitions(livraison, PROCESS_CREWDECK)).toEqual([{ kind: 'phase.removed', phase: { id: 'ph-livraison', name: 'Livraison' } }]);
  });

  it('gives a renamed Phase as one phase.renamed, never a removal and an addition', () => {
    const renamed = edited((draft) => (phaseOf(draft, 'ph-dev').name = 'Réalisation'));
    expect(diffDefinitions(PROCESS_CREWDECK, renamed)).toEqual([{ kind: 'phase.renamed', phaseId: 'ph-dev', from: 'Développement', to: 'Réalisation' }]);
  });

  it('gives a Phase whose « pour chaque » changed, from the fixture for-each-duplicate', () => {
    const fixture = PROCESS_CASES.find((processCase) => processCase.name === 'for-each-duplicate')!;
    expect(diffDefinitions(PROCESS_CREWDECK, fixture.definition)).toEqual([
      { kind: 'phase.for-each-changed', phase: { id: 'ph-dev', name: 'Développement' }, from: 'ticket.ready', to: 'idea.retained' },
    ]);
  });

  it('gives an Étape added, removed, and moved to another Phase, each with its Phase', () => {
    const added = edited((draft) => draft.steps.push({ ...defaultStep('inventory', { id: 'st-inventaire', phaseId: 'ph-conception', col: 6, row: 1 }), name: 'Inventaire' }));
    expect(diffDefinitions(PROCESS_CREWDECK, added)).toEqual([
      { kind: 'step.added', step: { id: 'st-inventaire', name: 'Inventaire' }, phase: { id: 'ph-conception', name: 'Conception' } },
    ]);
    expect(diffDefinitions(added, PROCESS_CREWDECK)).toEqual([
      { kind: 'step.removed', step: { id: 'st-inventaire', name: 'Inventaire' }, phase: { id: 'ph-conception', name: 'Conception' } },
    ]);

    const moved = edited((draft) => Object.assign(stepOf(draft, 'st-rv'), { phaseId: 'ph-conception', col: 6, row: 2 }));
    expect(diffDefinitions(PROCESS_CREWDECK, moved)).toEqual([
      { kind: 'step.moved', step: { id: 'st-rv', name: 'Revue visuelle' }, from: { id: 'ph-dev', name: 'Développement' }, to: { id: 'ph-conception', name: 'Conception' } },
    ]);
  });

  it('gives an Étape removed with its arrows and Retours as that one change, from the fixture crewdeck-github', () => {
    const base = PROCESS_CASES.find((processCase) => processCase.name === 'crewdeck-github')!.definition;
    const without = structuredClone(base);
    without.steps = without.steps.filter((step) => step.id !== 'st-rv');
    without.arrows = without.arrows.filter((arrow) => arrow.from.stepId !== 'st-rv' && arrow.to.stepId !== 'st-rv');
    without.loopBacks = without.loopBacks.filter((loopBack) => loopBack.from !== 'st-rv');
    expect(diffDefinitions(base, without)).toEqual([
      { kind: 'step.removed', step: { id: 'st-rv', name: 'Revue visuelle' }, phase: { id: 'ph-dev', name: 'Développement' } },
    ]);
  });

  it('gives an arrow added and removed between kept Étapes, with both ends’ names', () => {
    const fixture = PROCESS_CASES.find((processCase) => processCase.name === 'input-many-arrows')!;
    expect(diffDefinitions(PROCESS_CREWDECK, fixture.definition)).toEqual([
      {
        kind: 'arrow.added',
        from: { stepId: 'st-rv', portId: 'verdict', name: 'Revue visuelle' },
        to: { stepId: 'st-merge', portId: 'v-review', name: 'Merge' },
      },
    ]);
    const removed = edited((draft) => (draft.arrows = draft.arrows.filter((arrow) => !(arrow.from.stepId === 'st-review' && arrow.to.stepId === 'st-merge'))));
    expect(diffDefinitions(PROCESS_CREWDECK, removed)).toEqual([
      {
        kind: 'arrow.removed',
        from: { stepId: 'st-review', portId: 'verdict', name: 'Review' },
        to: { stepId: 'st-merge', portId: 'v-review', name: 'Merge' },
      },
    ]);
  });

  it('gives a Retour added, removed, and its maximum changed with the old and the new one', () => {
    const removed = edited((draft) => (draft.loopBacks = draft.loopBacks.filter((loopBack) => loopBack.from !== 'st-review')));
    const review = { from: { id: 'st-review', name: 'Review' }, to: { id: 'st-code', name: 'Code' } };
    expect(diffDefinitions(PROCESS_CREWDECK, removed)).toEqual([{ kind: 'loop-back.removed', ...review, max: 3 }]);
    expect(diffDefinitions(removed, PROCESS_CREWDECK)).toEqual([{ kind: 'loop-back.added', ...review, max: 3 }]);

    const five = edited((draft) => (draft.loopBacks.find((loopBack) => loopBack.from === 'st-review')!.max = 5));
    expect(diffDefinitions(PROCESS_CREWDECK, five)).toEqual([{ kind: 'loop-back.max-changed', ...review, before: 3, after: 5 }]);
  });

  it('gives an Outil attached and detached, with its Étape', () => {
    const stitch = edited((draft) => stepOf(draft, 'st-maquettes').tools.push({ kind: 'mcp', name: 'stitch' }));
    const maquettes = { id: 'st-maquettes', name: 'Maquettes' };
    expect(diffDefinitions(PROCESS_CREWDECK, stitch)).toEqual([{ kind: 'tool.attached', step: maquettes, tool: { kind: 'mcp', name: 'stitch' } }]);
    expect(diffDefinitions(stitch, PROCESS_CREWDECK)).toEqual([{ kind: 'tool.detached', step: maquettes, tool: { kind: 'mcp', name: 'stitch' } }]);
  });

  it('gives every move of a cell inside its Phase, and of a Phase, as one layout.changed', () => {
    const moved = edited((draft) => {
      Object.assign(stepOf(draft, 'st-rv'), { col: 5, row: 2 });
      Object.assign(stepOf(draft, 'st-tri'), { col: 3 });
      Object.assign(phaseOf(draft, 'ph-dev'), { col: 2 });
    });
    expect(diffDefinitions(PROCESS_CREWDECK, moved)).toEqual([{ kind: 'layout.changed' }]);
  });

  it('gives one change per kind, in the order of the kinds', () => {
    const base = edited((draft) => draft.phases.push({ id: 'ph-qa', name: 'Qualité', col: 1, row: 5, forEach: null }));
    const changed = structuredClone(base);
    ((draft: ProcessDefinition) => {
      draft.phases = draft.phases.filter((phase) => phase.id !== 'ph-qa');
      draft.phases.push({ id: 'ph-livraison', name: 'Livraison', col: 1, row: 4, forEach: null });
      draft.steps.push({ ...defaultStep('inventory', { id: 'st-inventaire', phaseId: 'ph-conception', col: 6, row: 1 }), name: 'Inventaire' });
      Object.assign(phaseOf(draft, 'ph-idee'), { name: 'Idées', forEach: 'idea.retained' });
      phaseOf(draft, 'ph-conception').forEach = 'idea.noted';
      Object.assign(stepOf(draft, 'st-rv'), { phaseId: 'ph-conception', col: 6, row: 2 });
      draft.arrows.push({ from: { stepId: 'st-checks', portId: 'verdict' }, to: { stepId: 'st-merge', portId: 'v-rv' } });
      draft.arrows = draft.arrows.filter((arrow) => !(arrow.from.stepId === 'st-checks' && arrow.to.stepId === 'st-review'));
      draft.loopBacks = draft.loopBacks.filter((loopBack) => loopBack.from !== 'st-rc-prd');
      draft.loopBacks.push({ from: 'st-checks', to: 'st-code', max: 2 });
      draft.loopBacks.find((loopBack) => loopBack.from === 'st-review')!.max = 5;
      stepOf(draft, 'st-maquettes').tools.push({ kind: 'mcp', name: 'stitch' });
      stepOf(draft, 'st-checks').tools = [];
      stepOf(draft, 'st-tri').col = 3;
      draft.steps = draft.steps.filter((step) => step.id !== 'st-ap-tickets');
      draft.arrows = draft.arrows.filter((arrow) => arrow.from.stepId !== 'st-ap-tickets' && arrow.to.stepId !== 'st-ap-tickets');
      draft.loopBacks = draft.loopBacks.filter((loopBack) => loopBack.from !== 'st-ap-tickets');
    })(changed);
    const kinds = diffDefinitions(base, changed).map((change) => change.kind);
    // Two Phases change their « pour chaque »: that kind twice.
    expect(kinds.toSorted()).toEqual([...PROCESS_CHANGE_KINDS, 'phase.for-each-changed'].toSorted());
    expect(kinds).toEqual([...kinds].sort((a, b) => PROCESS_CHANGE_KINDS.indexOf(a) - PROCESS_CHANGE_KINDS.indexOf(b)));
  });
});
