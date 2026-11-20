import { defaultStep, findGaps, type ProcessDefinition, validateDefinition } from '@crewdeck/contracts';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  addPhase,
  addStep,
  canRemovePhase,
  addLoopBack,
  attachTool,
  detachTool,
  canRemoveStep,
  loopBackTargets,
  removeLoopBack,
  setLoopBackMax,
  candidates,
  connect,
  disconnect,
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

const ref = (stepId: string, portId: string) => ({ stepId, portId });

describe('connect', () => {
  it('adds the arrow from a Sortie to an unfed Entrée of its type', () => {
    const base = accepted(disconnect(GITHUB, ref('st-code', 'changement'), ref('st-merge', 'changement')));
    const definition = accepted(connect(base, ref('st-code', 'changement'), ref('st-merge', 'changement')));
    expect(definition.arrows).toContainEqual({ from: ref('st-code', 'changement'), to: ref('st-merge', 'changement') });
  });

  it('refuses a Sortie onto an Entrée of another type, with the rule’s label', () => {
    expect(refused(connect(GITHUB, ref('st-code', 'changement'), ref('st-rv', 'maquettes')))).toBe(
      'Une Sortie Changement de code ne va que vers une Entrée Changement de code',
    );
  });

  it('refuses an arrow that would close a cycle', () => {
    const base = accepted(disconnect(GITHUB, ref('st-ap-tickets', 'document'), ref('st-code', 'ticket')));
    const withTicket = accepted(connect(base, ref('st-ap-tickets', 'document'), ref('st-code', 'ticket')));
    expect(withTicket.arrows).toHaveLength(GITHUB.arrows.length);
    // Code → Checks → Review: the Review's Verdict back into the Checks would loop.
    const unfedChecks = accepted(disconnect(GITHUB, ref('st-code', 'changement'), ref('st-checks', 'changement')));
    expect(refused(connect(unfedChecks, ref('st-merge', 'changement'), ref('st-checks', 'changement')))).toBe(
      'Cette flèche ferait une boucle : une boucle n’existe que comme Retour, avec son maximum.',
    );
  });

  it('refuses an Entrée already fed', () => {
    expect(refused(connect(GITHUB, ref('st-code', 'changement'), ref('st-review', 'changement')))).toBe(
      'L’Entrée « Changement de code » de « Review » a déjà sa flèche',
    );
  });

  it('refuses an arrow from an Entrée', () => {
    expect(refused(connect(GITHUB, ref('st-review', 'changement'), ref('st-merge', 'changement')))).toBe('Une flèche va d’une Sortie vers une Entrée');
  });
});

describe('disconnect', () => {
  it('removes the arrow: its Entrée becomes unfed', () => {
    const definition = accepted(disconnect(GITHUB, ref('st-review', 'verdict'), ref('st-merge', 'v-review')));
    expect(definition.arrows).toHaveLength(GITHUB.arrows.length - 1);
    expect(definition.arrows).not.toContainEqual({ from: ref('st-review', 'verdict'), to: ref('st-merge', 'v-review') });
  });

  it('gives back the same definition for an arrow it does not hold', () => {
    const result = disconnect(GITHUB, ref('st-review', 'verdict'), ref('st-checks', 'changement'));
    expect(result).toEqual({ ok: true, definition: GITHUB });
  });
});

describe('candidates', () => {
  it('lists the Sorties of the Entrée’s type the rules accept, in the definition’s order', () => {
    const base = accepted(disconnect(GITHUB, ref('st-checks', 'verdict'), ref('st-review', 'verdict')));
    // A Verdict: every Sortie of the type but the Review's own, which would go to itself.
    expect(candidates(base, ref('st-review', 'verdict'))).toEqual([
      ref('st-rc-prd', 'verdict'),
      ref('st-rc-ct', 'verdict'),
      ref('st-checks', 'verdict'),
      ref('st-rv', 'verdict'),
    ]);
  });

  it('lists nothing for an Entrée already fed', () => {
    expect(candidates(GITHUB, ref('st-review', 'verdict'))).toEqual([]);
  });
});

describe('addLoopBack', () => {
  const withoutReview = { ...GITHUB, loopBacks: GITHUB.loopBacks.filter((loop) => loop.from !== 'st-review') };

  it('adds a Retour from an Étape that judges to an earlier one of its Phase, 3 times at most', () => {
    const definition = accepted(addLoopBack(withoutReview, 'st-review', 'st-code'));
    expect(definition.loopBacks).toContainEqual({ from: 'st-review', to: 'st-code', max: 3 });
  });

  it('refuses one from an Étape that does not judge', () => {
    expect(refused(addLoopBack(GITHUB, 'st-checks', 'st-code'))).toBe('« Checks » ne juge pas : un Retour part d’une Étape qui juge');
  });

  it('refuses one to another Phase', () => {
    expect(refused(addLoopBack(withoutReview, 'st-review', 'st-ct'))).toBe('Un Retour reste dans sa Phase : « Conception technique » n’est pas dans « Développement »');
  });

  it('refuses one to an Étape that does not come before', () => {
    expect(refused(addLoopBack(withoutReview, 'st-review', 'st-merge'))).toBe('Un Retour revient en arrière : « Merge » ne vient pas avant « Review »');
  });

  it('refuses a second one from the same Étape', () => {
    expect(refused(addLoopBack(GITHUB, 'st-review', 'st-checks'))).toBe('« Review » a déjà son Retour');
  });
});

describe('setLoopBackMax', () => {
  it('sets the Retour’s maximum, 1 to 10', () => {
    expect(accepted(setLoopBackMax(GITHUB, 'st-review', 10)).loopBacks).toContainEqual({ from: 'st-review', to: 'st-code', max: 10 });
    expect(accepted(setLoopBackMax(GITHUB, 'st-review', 1)).loopBacks).toContainEqual({ from: 'st-review', to: 'st-code', max: 1 });
  });

  it('refuses a maximum outside 1 to 10', () => {
    expect(refused(setLoopBackMax(GITHUB, 'st-review', 0))).toBe('Un Retour se prend de 1 à 10 fois.');
    expect(refused(setLoopBackMax(GITHUB, 'st-review', 11))).toBe('Un Retour se prend de 1 à 10 fois.');
  });

  it('gives back the same definition for the same maximum', () => {
    expect(setLoopBackMax(GITHUB, 'st-review', 3)).toEqual({ ok: true, definition: GITHUB });
  });
});

describe('removeLoopBack', () => {
  it('removes the Retour leaving the Étape', () => {
    const definition = accepted(removeLoopBack(GITHUB, 'st-review'));
    expect(definition.loopBacks.some((loop) => loop.from === 'st-review')).toBe(false);
    expect(definition.loopBacks).toHaveLength(GITHUB.loopBacks.length - 1);
  });
});

describe('loopBackTargets', () => {
  it('lists the Étapes a Retour from it may go to', () => {
    const withoutReview = { ...GITHUB, loopBacks: GITHUB.loopBacks.filter((loop) => loop.from !== 'st-review') };
    expect(loopBackTargets(withoutReview, 'st-review')).toEqual(['st-code', 'st-checks']);
  });

  it('lists nothing for an Étape that does not judge, or that has its Retour', () => {
    expect(loopBackTargets(GITHUB, 'st-checks')).toEqual([]);
    expect(loopBackTargets(GITHUB, 'st-review')).toEqual([]);
  });
});

describe('attachTool', () => {
  const REPOSITORY = { repository: 'MaximeD1412/site-mairie' };
  const LOCAL_PROJECT = { repository: null };
  const SOURCES = { ticket: 'github', code: 'github' } as const;
  const tools = (definition: ProcessDefinition, id: string) => step(definition, id)?.tools;
  const capabilityGaps = (definition: ProcessDefinition) => findGaps(definition, SOURCES).filter((gap) => gap.kind === 'capability.missing');

  it('replaces an agent Étape’s Rôle, and its Skill: one of each', () => {
    const roled = accepted(attachTool(GITHUB, 'st-review', { kind: 'role', roleId: 'code' }, REPOSITORY));
    expect(tools(roled, 'st-review')).toEqual([
      { kind: 'role', roleId: 'code' },
      { kind: 'skill', skillId: 'review' },
    ]);
    const skilled = accepted(attachTool(roled, 'st-review', { kind: 'skill', skillId: 'cross-review' }, REPOSITORY));
    expect(tools(skilled, 'st-review')).toEqual([
      { kind: 'role', roleId: 'code' },
      { kind: 'skill', skillId: 'cross-review' },
    ]);
  });

  it('attaches a Serveur MCP once by name', () => {
    const definition = accepted(attachTool(GITHUB, 'st-maquettes', { kind: 'mcp', name: 'stitch' }, REPOSITORY));
    expect(tools(definition, 'st-maquettes')).toContainEqual({ kind: 'mcp', name: 'stitch' });
    expect(attachTool(definition, 'st-maquettes', { kind: 'mcp', name: 'stitch' }, REPOSITORY)).toEqual({ ok: true, definition });
  });

  it('attaches the Connecteur GitHub only for a Projet with a repository', () => {
    expect(tools(accepted(attachTool(GITHUB, 'st-review', { kind: 'connector', connector: 'github' }, REPOSITORY)), 'st-review')).toContainEqual({
      kind: 'connector',
      connector: 'github',
    });
    expect(refused(attachTool(LOCAL, 'st-review', { kind: 'connector', connector: 'github' }, LOCAL_PROJECT))).toBe(
      'Le Connecteur GitHub demande un Dépôt GitHub : ce Projet n’en a pas.',
    );
  });

  it('adds a Commande to the definition with its Outil, which meets the Étape’s capability', () => {
    const missing = fixture('capability-missing-command');
    expect(capabilityGaps(missing).map((gap) => gap.target)).toEqual(['steps.st-e2e']);
    const definition = accepted(attachTool(missing, 'st-e2e', { kind: 'command' }, REPOSITORY));
    expect(definition.commands).toEqual([{ id: 'cmd-1' }]);
    expect(tools(definition, 'st-e2e')).toEqual([{ kind: 'command', commandId: 'cmd-1' }]);
    expect(capabilityGaps(definition)).toEqual([]);
    const again = accepted(attachTool(definition, 'st-e2e', { kind: 'command' }, REPOSITORY));
    expect(again.commands).toEqual([{ id: 'cmd-1' }, { id: 'cmd-2' }]);
  });

  it('gives each family what it takes: the Checks a Connecteur or Commandes, a Commande Étape Commandes, a gate and the Merge nothing', () => {
    expect(tools(accepted(attachTool(LOCAL, 'st-checks', { kind: 'command' }, LOCAL_PROJECT)), 'st-checks')).toContainEqual({
      kind: 'command',
      commandId: 'cmd-1',
    });
    expect(refused(attachTool(GITHUB, 'st-checks', { kind: 'mcp', name: 'stitch' }, REPOSITORY))).toBe('« Checks » ne prend pas de Serveur MCP.');
    expect(refused(attachTool(GITHUB, 'st-checks', { kind: 'role', roleId: 'review' }, REPOSITORY))).toBe('« Checks » ne prend pas de Rôle.');
    const e2e = fixture('capability-missing-command');
    expect(refused(attachTool(e2e, 'st-e2e', { kind: 'connector', connector: 'github' }, REPOSITORY))).toBe(
      '« Tests de bout en bout » ne prend pas de Connecteur.',
    );
    expect(refused(attachTool(GITHUB, 'st-rv', { kind: 'skill', skillId: 'review' }, REPOSITORY))).toBe('« Revue visuelle » ne prend pas de Skill.');
    expect(refused(attachTool(GITHUB, 'st-merge', { kind: 'command' }, REPOSITORY))).toBe('« Merge » ne prend pas de Commande.');
  });

  it('refuses an eleventh Outil', () => {
    let definition = GITHUB;
    for (let n = 1; n <= 8; n += 1) definition = accepted(attachTool(definition, 'st-review', { kind: 'mcp', name: `mcp-${n}` }, REPOSITORY));
    expect(refused(attachTool(definition, 'st-review', { kind: 'mcp', name: 'one-more' }, REPOSITORY))).toBe('« Review » a déjà 10 Outils.');
    // Replacing its Rôle adds none.
    accepted(attachTool(definition, 'st-review', { kind: 'role', roleId: 'code' }, REPOSITORY));
  });
});

describe('detachTool', () => {
  const SOURCES = { ticket: 'github', code: 'github' } as const;

  it('detaching an agent Étape’s Rôle makes its capability.missing Manque appear', () => {
    const definition = accepted(detachTool(GITHUB, 'st-code', { kind: 'role', roleId: 'code' }));
    expect(step(definition, 'st-code')?.tools).toEqual([{ kind: 'skill', skillId: 'code' }]);
    expect(findGaps(definition, SOURCES)).toContainEqual({
      kind: 'capability.missing',
      target: 'steps.st-code',
      label: '« Code » a besoin d’un Rôle : aucun Outil attaché n’en donne',
    });
  });

  it('takes a Commande no other Étape uses out of the definition', () => {
    const withCommand = accepted(attachTool(fixture('capability-missing-command'), 'st-e2e', { kind: 'command' }, { repository: null }));
    const definition = accepted(detachTool(withCommand, 'st-e2e', { kind: 'command', commandId: 'cmd-1' }));
    expect(definition.commands).toEqual([]);
    expect(step(definition, 'st-e2e')?.tools).toEqual([]);
  });

  it('gives back the same definition for an Outil the Étape does not hold', () => {
    expect(detachTool(GITHUB, 'st-code', { kind: 'mcp', name: 'stitch' })).toEqual({ ok: true, definition: GITHUB });
  });
});
