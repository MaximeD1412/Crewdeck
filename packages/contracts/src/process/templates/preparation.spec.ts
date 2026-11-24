import { CATALOGUE } from '../catalogue.js';
import { zProcessDefinition } from '../definition.js';
import { PREPARATION } from './preparation.js';

describe('« Préparation »', () => {
  it('is a definition zProcessDefinition parses as it is: one Phase repeated for nothing, its one Étape the Inventaire, no arrow', () => {
    expect(zProcessDefinition.parse(PREPARATION)).toEqual(PREPARATION);
    expect(PREPARATION.phases).toEqual([{ id: 'ph-preparation', name: 'Préparation', col: 1, row: 1, forEach: null }]);
    expect(PREPARATION.steps.map((step) => [step.id, step.phaseId, step.kind, step.name])).toEqual([['st-inventory', 'ph-preparation', 'inventory', 'Inventaire']]);
    expect(PREPARATION.arrows).toEqual([]);
    expect(PREPARATION.loopBacks).toEqual([]);
  });

  it('gives the Inventaire the Rôle Conception and its Skill, its Sortie the inventaire', () => {
    const [inventory] = PREPARATION.steps;
    expect(inventory?.tools).toEqual([
      { kind: 'role', roleId: 'design' },
      { kind: 'skill', skillId: 'inventory' },
    ]);
    expect(CATALOGUE.inventory.role).toBe('design');
    expect(inventory?.inputs).toEqual([]);
    expect(inventory?.outputs.map((port) => [port.id, port.type])).toEqual([['inventaire', 'inventory']]);
  });
});
