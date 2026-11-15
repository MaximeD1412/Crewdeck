import { CONTRATS } from '../contrats/index.js';
import { ARTIFACT_TYPES } from './artifact-types.js';
import { AGENT_KINDS, CAPABILITIES, CATALOGUE, defaultStep, STEP_FAMILIES, STEP_KINDS, type StepKind, TOOL_CAPABILITIES } from './catalogue.js';
import { zStep } from './definition.js';

const DOCUMENTS = ['prd', 'mockups', 'technical-design', 'inventory', 'ticket'];

/** The table of the ticket: family, name, judges, needs, ports (`id: types`), extra Entrées, Rôle and Skill. */
const TABLE: Record<StepKind, [string, string, boolean, string[], Record<string, string[]>, Record<string, string[]>, string[], string | null, string | null]> = {
  'idea-analysis': ['agent', 'Analyse de l’Idée', false, ['agent'], { idee: ['idea'] }, { idee: ['idea'] }, [], 'idea', 'idea-analysis'],
  inventory: ['agent', 'Inventaire', false, ['agent'], {}, { inventaire: ['inventory'] }, [], 'design', 'inventory'],
  prd: ['agent', 'PRD', false, ['agent'], { idee: ['idea'] }, { prd: ['prd'] }, [], 'design', 'product-design'],
  mockups: ['agent', 'Maquettes', false, ['agent'], { prd: ['prd'] }, { maquettes: ['mockups'] }, [], 'design', 'visual-design'],
  'technical-design': ['agent', 'Conception technique', false, ['agent'], { prd: ['prd'], maquettes: ['mockups'] }, { conception: ['technical-design'] }, [], 'design', 'technical-design'],
  split: ['agent', 'Découpage en Tickets', false, ['agent'], { prd: ['prd'], maquettes: ['mockups'], conception: ['technical-design'] }, { ticket: ['ticket'] }, [], 'design', 'plan-backlog'],
  code: ['agent', 'Code', false, ['agent'], { ticket: ['ticket'] }, { changement: ['code-change'] }, [], 'code', 'code'],
  review: ['agent', 'Review', true, ['agent'], { changement: ['code-change'] }, { verdict: ['verdict'] }, ['verdict'], 'review', 'review'],
  'cross-review': ['agent', 'Revue croisée', true, ['agent'], { document: ['prd', 'technical-design', 'mockups', 'inventory'] }, { verdict: ['verdict'] }, [], 'review', 'cross-review'],
  'idea-triage': ['gate', 'Tri de l’Idée', false, [], { idee: ['idea'] }, { idee: ['idea'] }, [], null, null],
  approval: ['gate', 'Approbation', true, [], { document: DOCUMENTS }, { document: DOCUMENTS }, ['verdict'], null, null],
  'visual-review': ['gate', 'Revue visuelle', true, [], { changement: ['code-change'], maquettes: ['mockups'] }, { verdict: ['verdict'] }, [], null, null],
  command: ['command', 'Commande', false, ['command'], { changement: ['code-change'] }, { verdict: ['verdict', 'delivery'] }, [...ARTIFACT_TYPES], null, null],
  checks: ['core', 'Checks', false, ['ci', 'command'], { changement: ['code-change'] }, { verdict: ['verdict'] }, [], null, null],
  merge: ['core', 'Merge', false, [], { changement: ['code-change'] }, { changement: ['code-change'] }, ['verdict'], null, null],
};

const ports = (specs: readonly { id: string; types: readonly string[] }[]) => Object.fromEntries(specs.map((spec) => [spec.id, spec.types]));

describe('CATALOGUE', () => {
  it('has the 15 kinds of the table, with their family, name, ports, needs and default Rôle and Skill', () => {
    expect(Object.keys(CATALOGUE).sort()).toEqual([...STEP_KINDS].sort());
    expect(STEP_KINDS).toHaveLength(15);
    for (const kind of STEP_KINDS) {
      const [family, name, judges, needs, inputs, outputs, extraInputs, role, skill] = TABLE[kind];
      const spec = CATALOGUE[kind];
      expect({ family: spec.family, name: spec.name, judges: spec.judges, needs: spec.needs, role: spec.role, skill: spec.skill }, kind).toEqual({ family, name, judges, needs, role, skill });
      expect(ports(spec.inputs), kind).toEqual(inputs);
      expect(ports(spec.outputs), kind).toEqual(outputs);
      expect(spec.extraInputs, kind).toEqual(extraInputs);
    }
    expect(STEP_FAMILIES).toEqual(['agent', 'gate', 'command', 'core']);
    expect(CAPABILITIES).toEqual(['agent', 'command', 'ci']);
  });

  it('notes the Sortie of the Tri « retenue » and of the Merge « mergé », and gives the Approbation’s Sortie its Entrée’s type', () => {
    expect(CATALOGUE['idea-triage'].outputs[0]).toMatchObject({ note: 'retenue' });
    expect(CATALOGUE.merge.outputs[0]).toMatchObject({ note: 'mergé' });
    expect(CATALOGUE.approval.outputs[0]).toMatchObject({ sameTypeAs: 'document' });
  });

  it('keeps the Étapes du produit out of the menu, alone and never removed, and the last Review', () => {
    for (const kind of ['checks', 'merge'] as const) {
      expect(CATALOGUE[kind]).toMatchObject({ menu: null, unique: true, removable: 'never' });
    }
    expect(CATALOGUE.review.removable).toBe('keep-one');
    const others = STEP_KINDS.filter((kind) => !['checks', 'merge', 'review'].includes(kind));
    for (const kind of others) expect(CATALOGUE[kind], kind).toMatchObject({ unique: false, removable: 'yes' });
    expect(CATALOGUE.review.unique).toBe(false);
  });

  it('files each kind under its menu', () => {
    const menus = Object.fromEntries(STEP_KINDS.map((kind) => [kind, CATALOGUE[kind].menu]));
    expect(menus).toEqual({
      'idea-analysis': 'process',
      inventory: 'process',
      prd: 'process',
      mockups: 'process',
      'technical-design': 'process',
      split: 'process',
      code: 'process',
      'idea-triage': 'process',
      approval: 'process',
      review: 'reviews',
      'cross-review': 'reviews',
      'visual-review': 'reviews',
      command: 'runner',
      checks: null,
      merge: null,
    });
  });

  it('lists the agent kinds in the order of the Contrats’ Étapes', () => {
    expect(AGENT_KINDS).toEqual(STEP_KINDS.filter((kind) => CATALOGUE[kind].family === 'agent'));
    expect(AGENT_KINDS).toEqual(['idea-analysis', 'inventory', 'prd', 'mockups', 'technical-design', 'cross-review', 'split', 'code', 'review']);
  });

  it('names only Contrats that exist', () => {
    const ids = new Set(CONTRATS.map((contrat) => contrat.id));
    for (const kind of STEP_KINDS) {
      const { contrat } = CATALOGUE[kind];
      if (contrat !== null) expect(ids.has(contrat), `${kind}: ${contrat}`).toBe(true);
    }
  });
});

describe('defaultStep', () => {
  const at = { id: 'st-new', phaseId: 'ph-dev', col: 2, row: 3 };

  it('gives each kind its name and its ports, each of its first type with its note', () => {
    for (const kind of STEP_KINDS) {
      const step = defaultStep(kind, at);
      const spec = CATALOGUE[kind];
      expect(zStep.parse(step), kind).toEqual(step);
      expect(step, kind).toMatchObject({ ...at, kind, name: spec.name });
      const portsOf = (specs: typeof spec.inputs) => specs.map((port) => ({ id: port.id, type: port.types[0], ...(port.note === undefined ? {} : { note: port.note }) }));
      expect(step.inputs, kind).toEqual(portsOf(spec.inputs));
      expect(step.outputs, kind).toEqual(portsOf(spec.outputs));
    }
  });

  it('gives an agent kind its Rôle and its Skill as Outils, and the others none', () => {
    expect(defaultStep('code', at).tools).toEqual([
      { kind: 'role', roleId: 'code' },
      { kind: 'skill', skillId: 'code' },
    ]);
    expect(defaultStep('cross-review', at).tools).toEqual([
      { kind: 'role', roleId: 'review' },
      { kind: 'skill', skillId: 'cross-review' },
    ]);
    for (const kind of STEP_KINDS.filter((kind) => CATALOGUE[kind].family !== 'agent')) expect(defaultStep(kind, at).tools, kind).toEqual([]);
  });

  it('gives the Approbation a PRD by default, in and out', () => {
    const step = defaultStep('approval', at);
    expect(step.inputs).toEqual([{ id: 'document', type: 'prd' }]);
    expect(step.outputs).toEqual([{ id: 'document', type: 'prd' }]);
  });
});

describe('TOOL_CAPABILITIES', () => {
  it('gives agent to a Rôle, command to a Commande, ci to the GitHub Connecteur, nothing to a Skill or a Serveur MCP', () => {
    expect(TOOL_CAPABILITIES).toEqual({ role: ['agent'], command: ['command'], connector: ['ci'], skill: [], mcp: [] });
  });
});
