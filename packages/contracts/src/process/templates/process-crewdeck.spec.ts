import { CATALOGUE } from '../catalogue.js';
import { type Port, type ProcessDefinition, zProcessDefinition } from '../definition.js';
import { BUILTIN_TEMPLATES, PROCESS_CREWDECK, PROCESS_CREWDECK_NAME } from './process-crewdeck.js';

/** `id:type` or `id:type:note`. */
const portsOf = (ports: readonly Port[]) => ports.map((port) => [port.id, port.type, port.note].filter((part) => part !== undefined).join(':'));

const STEPS: [string, string, string, string, number, number, string[], string[]][] = [
  ['st-analyse', 'ph-idee', 'idea-analysis', 'Analyse de l’Idée', 1, 1, ['idee:idea:notée par toi'], ['idee:idea']],
  ['st-tri', 'ph-idee', 'idea-triage', 'Tri de l’Idée', 2, 1, ['idee:idea'], ['idee:idea:retenue']],
  ['st-prd', 'ph-conception', 'prd', 'PRD', 1, 1, ['idee:idea'], ['prd:prd']],
  ['st-rc-prd', 'ph-conception', 'cross-review', 'Revue croisée du PRD', 2, 1, ['document:prd'], ['verdict:verdict']],
  ['st-ap-prd', 'ph-conception', 'approval', 'Approbation du PRD', 3, 1, ['document:prd', 'verdict:verdict'], ['document:prd']],
  ['st-maquettes', 'ph-conception', 'mockups', 'Maquettes', 4, 1, ['prd:prd'], ['maquettes:mockups']],
  ['st-ap-maquettes', 'ph-conception', 'approval', 'Revue des maquettes', 5, 1, ['document:mockups'], ['document:mockups']],
  ['st-ct', 'ph-conception', 'technical-design', 'Conception technique', 1, 2, ['prd:prd', 'maquettes:mockups'], ['conception:technical-design']],
  ['st-rc-ct', 'ph-conception', 'cross-review', 'Revue croisée de la conception', 2, 2, ['document:technical-design'], ['verdict:verdict']],
  ['st-ap-ct', 'ph-conception', 'approval', 'Approbation de la conception', 3, 2, ['document:technical-design', 'verdict:verdict'], ['document:technical-design']],
  ['st-decoupage', 'ph-conception', 'split', 'Découpage en Tickets', 4, 2, ['prd:prd', 'maquettes:mockups', 'conception:technical-design'], ['ticket:ticket']],
  ['st-ap-tickets', 'ph-conception', 'approval', 'Validation des Tickets', 5, 2, ['document:ticket'], ['document:ticket:prêt']],
  ['st-code', 'ph-dev', 'code', 'Code', 1, 1, ['ticket:ticket'], ['changement:code-change']],
  ['st-checks', 'ph-dev', 'checks', 'Checks', 2, 1, ['changement:code-change'], ['verdict:verdict']],
  ['st-review', 'ph-dev', 'review', 'Review', 3, 1, ['changement:code-change', 'verdict:verdict:des checks'], ['verdict:verdict']],
  ['st-rv', 'ph-dev', 'visual-review', 'Revue visuelle', 3, 2, ['changement:code-change', 'maquettes:mockups'], ['verdict:verdict']],
  [
    'st-merge',
    'ph-dev',
    'merge',
    'Merge',
    4,
    1,
    ['changement:code-change', 'v-review:verdict:de la Review', 'v-rv:verdict:de la Revue visuelle'],
    ['changement:code-change:mergé'],
  ],
];

const ARROWS = [
  'st-analyse.idee → st-tri.idee',
  'st-tri.idee → st-prd.idee',
  'st-prd.prd → st-rc-prd.document',
  'st-prd.prd → st-ap-prd.document',
  'st-rc-prd.verdict → st-ap-prd.verdict',
  'st-ap-prd.document → st-maquettes.prd',
  'st-maquettes.maquettes → st-ap-maquettes.document',
  'st-ap-prd.document → st-ct.prd',
  'st-ap-maquettes.document → st-ct.maquettes',
  'st-ct.conception → st-rc-ct.document',
  'st-ct.conception → st-ap-ct.document',
  'st-rc-ct.verdict → st-ap-ct.verdict',
  'st-ap-prd.document → st-decoupage.prd',
  'st-ap-maquettes.document → st-decoupage.maquettes',
  'st-ap-ct.document → st-decoupage.conception',
  'st-decoupage.ticket → st-ap-tickets.document',
  'st-ap-tickets.document → st-code.ticket',
  'st-code.changement → st-checks.changement',
  'st-code.changement → st-review.changement',
  'st-checks.verdict → st-review.verdict',
  'st-code.changement → st-rv.changement',
  'st-ap-maquettes.document → st-rv.maquettes',
  'st-code.changement → st-merge.changement',
  'st-review.verdict → st-merge.v-review',
  'st-rv.verdict → st-merge.v-rv',
];

const LOOP_BACKS = [
  'st-rc-prd → st-prd',
  'st-rc-ct → st-ct',
  'st-review → st-code',
  'st-rv → st-code',
  'st-ap-prd → st-prd',
  'st-ap-maquettes → st-maquettes',
  'st-ap-ct → st-ct',
  'st-ap-tickets → st-decoupage',
];

const stepsById = (definition: ProcessDefinition) => new Map(definition.steps.map((step) => [step.id, step]));

describe('« Process Crewdeck »', () => {
  it('is a definition zProcessDefinition parses as it is', () => {
    expect(zProcessDefinition.parse(PROCESS_CREWDECK)).toEqual(PROCESS_CREWDECK);
    expect(PROCESS_CREWDECK_NAME).toBe('Process Crewdeck');
    expect(BUILTIN_TEMPLATES).toEqual({ 'process-crewdeck': PROCESS_CREWDECK });
  });

  it('has the three Phases, each repeated for its item', () => {
    expect(PROCESS_CREWDECK.phases).toEqual([
      { id: 'ph-idee', name: 'Idée', col: 1, row: 1, forEach: 'idea.noted' },
      { id: 'ph-conception', name: 'Conception', col: 1, row: 2, forEach: 'idea.retained' },
      { id: 'ph-dev', name: 'Développement', col: 1, row: 3, forEach: 'ticket.ready' },
    ]);
  });

  it('has the 17 Étapes, with their Phase, kind, name, position and ports', () => {
    expect(PROCESS_CREWDECK.steps.map((step) => [step.id, step.phaseId, step.kind, step.name, step.col, step.row, portsOf(step.inputs), portsOf(step.outputs)])).toEqual(STEPS);
  });

  it('gives every agent Étape its kind’s Rôle and Skill, the Checks the GitHub Connecteur, and the other Étapes no Outil', () => {
    for (const step of PROCESS_CREWDECK.steps) {
      const spec = CATALOGUE[step.kind];
      const expected =
        spec.family === 'agent'
          ? [
              { kind: 'role', roleId: spec.role },
              { kind: 'skill', skillId: spec.skill },
            ]
          : step.id === 'st-checks'
            ? [{ kind: 'connector', connector: 'github' }]
            : [];
      expect(step.tools, step.id).toEqual(expected);
    }
    expect(PROCESS_CREWDECK.steps.filter((step) => CATALOGUE[step.kind].family === 'agent')).toHaveLength(9);
  });

  it('has the 25 arrows of the mockup, each from a Sortie to an Entrée of the same type', () => {
    expect(PROCESS_CREWDECK.arrows.map(({ from, to }) => `${from.stepId}.${from.portId} → ${to.stepId}.${to.portId}`)).toEqual(ARROWS);
    const steps = stepsById(PROCESS_CREWDECK);
    for (const { from, to } of PROCESS_CREWDECK.arrows) {
      const output = steps.get(from.stepId)?.outputs.find((port) => port.id === from.portId);
      const input = steps.get(to.stepId)?.inputs.find((port) => port.id === to.portId);
      expect(output, `${from.stepId}.${from.portId}`).toBeDefined();
      expect(input, `${to.stepId}.${to.portId}`).toBeDefined();
      expect(input?.type, `${from.stepId}.${from.portId} → ${to.stepId}.${to.portId}`).toBe(output?.type);
    }
  });

  it('has the 8 Retours, each from an Étape that judges, at most 3 times, and no Commande', () => {
    expect(PROCESS_CREWDECK.loopBacks.map(({ from, to }) => `${from} → ${to}`)).toEqual(LOOP_BACKS);
    const steps = stepsById(PROCESS_CREWDECK);
    for (const loopBack of PROCESS_CREWDECK.loopBacks) {
      expect(loopBack.max).toBe(3);
      expect(CATALOGUE[steps.get(loopBack.from)!.kind].judges, loopBack.from).toBe(true);
      expect(steps.get(loopBack.to)!.phaseId).toBe(steps.get(loopBack.from)!.phaseId);
    }
    expect(PROCESS_CREWDECK.commands).toEqual([]);
  });

  it('names each block once: Phases and Étapes share one namespace, a port is unique in its Étape', () => {
    const ids = [...PROCESS_CREWDECK.phases, ...PROCESS_CREWDECK.steps].map((block) => block.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const step of PROCESS_CREWDECK.steps) {
      for (const ports of [step.inputs, step.outputs]) expect(new Set(ports.map((port) => port.id)).size, step.id).toBe(ports.length);
    }
  });
});
