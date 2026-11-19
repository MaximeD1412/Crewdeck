import type { ProcessDefinition } from './definition.js';
import { groupsOfPhase } from './migration.js';
import { PROCESS_CREWDECK } from './templates/process-crewdeck.js';

describe('groupsOfPhase', () => {
  it('gives the groups of Source the Phase’s Étapes read or write, from their Entrées and Sorties', () => {
    expect(groupsOfPhase(PROCESS_CREWDECK, 'ph-dev')).toEqual(['ticket', 'code']);
  });

  it('gives none for a Phase that only touches the Idée, nor for one that does not exist', () => {
    expect(groupsOfPhase(PROCESS_CREWDECK, 'ph-idee')).toEqual([]);
    expect(groupsOfPhase(PROCESS_CREWDECK, 'ph-nowhere')).toEqual([]);
  });

  it('counts the Verdict and the documents with the code, the Livraison with nothing', () => {
    const definition: ProcessDefinition = {
      ...PROCESS_CREWDECK,
      phases: [{ id: 'ph-a', name: 'A', col: 1, row: 1, forEach: null }],
      steps: [
        { id: 'st-a', phaseId: 'ph-a', kind: 'checks', name: 'A', col: 1, row: 1, inputs: [{ id: 'in', type: 'verdict' }], outputs: [{ id: 'out', type: 'delivery' }], tools: [] },
      ],
      arrows: [],
      loopBacks: [],
    };
    expect(groupsOfPhase(definition, 'ph-a')).toEqual(['code']);
  });
});
