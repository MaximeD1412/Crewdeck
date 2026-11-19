import { defaultStep, type ProcessDefinition, validateDefinition } from '@crewdeck/contracts';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  addPhase,
  addStep,
  canRemovePhase,
  canRemoveStep,
  type EditResult,
  moveStep,
  moveStepToPhase,
  removePhase,
  removeStep,
  renamePhase,
  setForEach,
} from './edit.js';

const FIXTURES = join(import.meta.dirname, '../../../../packages/contracts/fixtures/process');
/** A case of the canvas's rules (PROCESS-2), as the server's tests read it. */
const fixture = (name: string): ProcessDefinition =>
  (JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), 'utf8')) as { definition: ProcessDefinition }).definition;

const GITHUB = fixture('crewdeck-github');
const LOCAL = fixture('crewdeck-local');
const COMMAND = fixture('checks-local-command');

const CORE_MISSING = '« Checks », « Merge » et une Review sont dans chaque Process : ils ne se retirent pas';

const accepted = (result: EditResult): ProcessDefinition => {
  if (!result.ok) throw new Error(`refused: ${result.reason}`);
  expect(validateDefinition(result.definition)).toEqual([]);
  return result.definition;
};
const refused = (result: EditResult): string => {
  if (result.ok) throw new Error('accepted');
  return result.reason;
};
const step = (definition: ProcessDefinition, id: string) => definition.steps.find((candidate) => candidate.id === id);
const phase = (definition: ProcessDefinition, id: string) => definition.phases.find((candidate) => candidate.id === id);
const touching = (definition: ProcessDefinition, id: string) =>
  definition.arrows.filter((arrow) => arrow.from.stepId === id || arrow.to.stepId === id);

describe('addStep', () => {
  it('puts the kind’s default Étape at the Phase’s next free cell in reading order, its name, ports, Rôle and Skill', () => {
    const definition = accepted(addStep(GITHUB, 'cross-review', 'ph-dev'));
    // Développement holds (1,1) to (4,1) and (3,2): (5,1) is the next.
    expect(step(definition, 'st-cross-review')).toEqual(defaultStep('cross-review', { id: 'st-cross-review', phaseId: 'ph-dev', col: 5, row: 1 }));
    expect(step(definition, 'st-cross-review')?.tools).toEqual([
      { kind: 'role', roleId: 'review' },
      { kind: 'skill', skillId: 'cross-review' },
    ]);
    expect(definition.steps).toHaveLength(GITHUB.steps.length + 1);
  });

  it('goes to the next row after five columns', () => {
    // Conception holds every cell of its two rows.
    expect(step(accepted(addStep(GITHUB, 'prd', 'ph-conception')), 'st-prd-2')).toMatchObject({ col: 1, row: 3 });
    const twice = accepted(addStep(accepted(addStep(GITHUB, 'code', 'ph-dev')), 'code', 'ph-dev'));
    expect(step(twice, 'st-code-2')).toMatchObject({ col: 5, row: 1 });
    expect(step(twice, 'st-code-3')).toMatchObject({ col: 1, row: 2 });
  });

  it('gives an id unique in the definition: st-<kind>, else -2, -3…', () => {
    const once = accepted(addStep(GITHUB, 'command', 'ph-dev'));
    expect(step(once, 'st-command')?.kind).toBe('command');
    const again = accepted(addStep(once, 'command', 'ph-dev'));
    expect(step(again, 'st-command-2')?.kind).toBe('command');
    // `st-code` is « Process Crewdeck »'s Code.
    expect(step(accepted(addStep(GITHUB, 'code', 'ph-idee')), 'st-code-2')).toMatchObject({ phaseId: 'ph-idee', col: 3, row: 1 });
  });

  it('refuses the Étapes du produit, never in the menu', () => {
    expect(refused(addStep(GITHUB, 'checks', 'ph-dev'))).toBe('« Checks » est une Étape du produit : elle ne s’ajoute pas.');
    expect(refused(addStep(GITHUB, 'merge', 'ph-dev'))).toBe('« Merge » est une Étape du produit : elle ne s’ajoute pas.');
  });

  it('refuses what validateDefinition refuses, with its label', () => {
    expect(refused(addStep(GITHUB, 'code', 'ph-nulle-part'))).toBe('« Code » est dans une Phase qui n’existe pas : « ph-nulle-part »');
  });
});

describe('removeStep', () => {
  it('takes its arrows and its Retours with it', () => {
    expect(touching(GITHUB, 'st-rv')).toHaveLength(3);
    expect(GITHUB.loopBacks.some((loop) => loop.from === 'st-rv')).toBe(true);
    const definition = accepted(removeStep(GITHUB, 'st-rv'));
    expect(step(definition, 'st-rv')).toBeUndefined();
    expect(touching(definition, 'st-rv')).toEqual([]);
    expect(definition.loopBacks.some((loop) => loop.from === 'st-rv' || loop.to === 'st-rv')).toBe(false);
    expect(definition.arrows).toHaveLength(GITHUB.arrows.length - 3);
  });

  it('removes an Étape a Retour goes to with the Retour', () => {
    const definition = accepted(removeStep(GITHUB, 'st-maquettes'));
    expect(definition.loopBacks.some((loop) => loop.to === 'st-maquettes')).toBe(false);
  });

  it('takes the Commandes only it uses, keeps those another Étape uses', () => {
    const withCommand: ProcessDefinition = {
      ...COMMAND,
      steps: [...COMMAND.steps, { ...defaultStep('command', { id: 'st-e2e', phaseId: 'ph-dev', col: 5, row: 1 }), tools: [{ kind: 'command', commandId: 'e2e' }, { kind: 'command', commandId: 'checks' }] }],
      commands: [...COMMAND.commands, { id: 'e2e' }],
    };
    expect(accepted(removeStep(withCommand, 'st-e2e')).commands).toEqual([{ id: 'checks' }]);
  });

  it('refuses the Checks, the Merge and the last Review, with core.missing’s label', () => {
    expect(refused(removeStep(GITHUB, 'st-checks'))).toBe(CORE_MISSING);
    expect(refused(removeStep(GITHUB, 'st-merge'))).toBe(CORE_MISSING);
    expect(refused(removeStep(GITHUB, 'st-review'))).toBe(CORE_MISSING);
  });

  it('lets a second Review go, and then the first', () => {
    const two = accepted(addStep(GITHUB, 'review', 'ph-dev'));
    expect(accepted(removeStep(two, 'st-review')).steps.filter((candidate) => candidate.kind === 'review')).toHaveLength(1);
  });
});

describe('canRemoveStep', () => {
  it('answers as removeStep would, without applying it', () => {
    expect(canRemoveStep(GITHUB, 'st-rv')).toEqual({ ok: true });
    expect(canRemoveStep(GITHUB, 'st-checks')).toEqual({ ok: false, reason: CORE_MISSING, kind: 'core.missing' });
    expect(step(GITHUB, 'st-checks')).toBeDefined();
  });
});

describe('moveStep', () => {
  it('puts the Étape on a free cell of another Phase with its arrows', () => {
    const definition = accepted(moveStep(GITHUB, 'st-rv', 'ph-dev', 5, 1));
    expect(step(definition, 'st-rv')).toMatchObject({ phaseId: 'ph-dev', col: 5, row: 1 });
    expect(touching(definition, 'st-rv')).toEqual(touching(GITHUB, 'st-rv'));
    const local = accepted(moveStep(LOCAL, 'st-tri', 'ph-conception', 1, 3));
    expect(step(local, 'st-tri')).toMatchObject({ phaseId: 'ph-conception', col: 1, row: 3 });
    expect(touching(local, 'st-tri')).toEqual(touching(LOCAL, 'st-tri'));
  });

  it('refuses an occupied cell', () => {
    expect(refused(moveStep(GITHUB, 'st-rv', 'ph-dev', 1, 1))).toBe('Cette case est déjà prise par « Code ».');
  });

  it('keeps the same definition when the Étape is already there', () => {
    expect(moveStep(GITHUB, 'st-rv', 'ph-dev', 3, 2)).toEqual({ ok: true, definition: GITHUB });
  });

  it('refuses what the rules refuse: a Retour leaving its Phase', () => {
    expect(refused(moveStep(GITHUB, 'st-review', 'ph-conception', 1, 3))).toBe(
      'Un Retour reste dans sa Phase : « Code » n’est pas dans « Conception »',
    );
  });
});

describe('moveStepToPhase', () => {
  it('puts the Étape at that Phase’s next free cell', () => {
    const definition = accepted(moveStepToPhase(GITHUB, 'st-tri', 'ph-dev'));
    expect(step(definition, 'st-tri')).toMatchObject({ phaseId: 'ph-dev', col: 5, row: 1 });
  });

  it('keeps the same definition for its own Phase', () => {
    expect(moveStepToPhase(GITHUB, 'st-tri', 'ph-idee')).toEqual({ ok: true, definition: GITHUB });
  });
});

describe('addPhase', () => {
  it('adds « Nouvelle Phase » once, at the first free row under the Phases, column 1', () => {
    const definition = accepted(addPhase(GITHUB));
    expect(definition.phases.at(-1)).toEqual({ id: 'ph-1', name: 'Nouvelle Phase', col: 1, row: 4, forEach: null });
    const again = accepted(addPhase(definition));
    expect(again.phases.at(-1)).toEqual({ id: 'ph-2', name: 'Nouvelle Phase 2', col: 1, row: 5, forEach: null });
  });

  it('goes under a Phase beside the others too', () => {
    const livraison: ProcessDefinition = { ...LOCAL, phases: [...LOCAL.phases, { id: 'ph-livraison', name: 'Livraison', col: 2, row: 3, forEach: null }] };
    expect(accepted(addPhase(livraison)).phases.at(-1)).toMatchObject({ col: 1, row: 4 });
  });
});

describe('removePhase', () => {
  it('takes its Étapes, their arrows and their Retours with it', () => {
    const definition = accepted(removePhase(GITHUB, 'ph-idee'));
    expect(phase(definition, 'ph-idee')).toBeUndefined();
    expect(definition.steps.some((candidate) => candidate.phaseId === 'ph-idee')).toBe(false);
    expect(touching(definition, 'st-tri')).toEqual([]);
    expect(definition.arrows).toHaveLength(GITHUB.arrows.length - 2);
    const conception = accepted(removePhase(GITHUB, 'ph-conception'));
    expect(conception.loopBacks.map((loop) => loop.from)).toEqual(['st-review', 'st-rv']);
  });

  it('removes an empty Phase', () => {
    const added = accepted(addPhase(GITHUB));
    expect(accepted(removePhase(added, 'ph-1'))).toEqual(GITHUB);
  });

  it('refuses a Phase holding the Checks, the Merge or the last Review', () => {
    expect(refused(removePhase(GITHUB, 'ph-dev'))).toBe(CORE_MISSING);
    expect(canRemovePhase(GITHUB, 'ph-dev')).toEqual({ ok: false, reason: CORE_MISSING, kind: 'core.missing' });
    expect(canRemovePhase(GITHUB, 'ph-idee')).toEqual({ ok: true });
  });
});

describe('renamePhase', () => {
  it('renames, trimmed', () => {
    expect(phase(accepted(renamePhase(GITHUB, 'ph-dev', '  Code et revue  ')), 'ph-dev')?.name).toBe('Code et revue');
  });

  it('refuses a name another Phase has, whatever its case', () => {
    expect(refused(renamePhase(GITHUB, 'ph-dev', 'Conception'))).toBe('Une Phase porte déjà ce nom.');
    expect(refused(renamePhase(GITHUB, 'ph-dev', 'conception'))).toBe('Une Phase porte déjà ce nom.');
  });

  it('refuses an empty name and one over 40 characters', () => {
    expect(refused(renamePhase(GITHUB, 'ph-dev', '   '))).toBe('Une Phase a un nom.');
    expect(refused(renamePhase(GITHUB, 'ph-dev', 'x'.repeat(41)))).toBe('Le nom d’une Phase tient en 40 caractères.');
    expect(phase(accepted(renamePhase(GITHUB, 'ph-dev', 'x'.repeat(40))), 'ph-dev')?.name).toHaveLength(40);
  });

  it('keeps the same definition for its own name', () => {
    expect(renamePhase(GITHUB, 'ph-dev', 'Développement ')).toEqual({ ok: true, definition: GITHUB });
  });
});

describe('setForEach', () => {
  it('sets what the Phase repeats for, or once', () => {
    const once = accepted(setForEach(GITHUB, 'ph-dev', null));
    expect(phase(once, 'ph-dev')?.forEach).toBeNull();
    expect(phase(accepted(setForEach(once, 'ph-dev', 'ticket.ready')), 'ph-dev')?.forEach).toBe('ticket.ready');
  });

  it('refuses a repetition another Phase has', () => {
    expect(refused(setForEach(GITHUB, 'ph-dev', 'idea.retained'))).toBe('« Développement » se répète pour chaque Idée retenue, comme « Conception »');
  });
});
