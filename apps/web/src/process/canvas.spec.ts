import { ARTIFACT_TYPES, findGaps, PORT_TYPES, PROCESS_CREWDECK, type ProcessDefinition } from '@crewdeck/contracts';
import { canvasOf, targetPhaseOf, type CanvasContext } from './canvas.js';

const CONTEXT: CanvasContext = { zoom: 90, pan: { x: 0, y: 0 }, roleNames: {}, focus: null };
const GITHUB = { ticket: 'github', code: 'github' } as const;

const crewdeck = (edit: (draft: ProcessDefinition) => void = () => undefined): ProcessDefinition => {
  const draft = structuredClone(PROCESS_CREWDECK);
  edit(draft);
  return draft;
};

const stepsOf = (data: ReturnType<typeof canvasOf>) => data.phases.flatMap((phase) => phase.steps);
const stepOf = (data: ReturnType<typeof canvasOf>, id: string) => {
  const step = stepsOf(data).find((candidate) => candidate.id === id);
  if (!step) throw new Error(`no Étape ${id}`);
  return step;
};

describe('canvasOf', () => {
  it('draws « Process Crewdeck » read only: its Phases at their cells, their Étapes, its arrows and Retours as defined', () => {
    const data = canvasOf(PROCESS_CREWDECK, [], null, CONTEXT);

    expect(data.editable).toBe(false);
    expect({ zoom: data.zoom, pan: data.pan }).toEqual({ zoom: 90, pan: { x: 0, y: 0 } });
    expect(data.phases.map(({ id, name, col, row, forEach }) => ({ id, name, col, row, forEach }))).toEqual([
      { id: 'ph-idee', name: 'Idée', col: 1, row: 1, forEach: 'chaque Idée notée' },
      { id: 'ph-conception', name: 'Conception', col: 1, row: 2, forEach: 'chaque Idée retenue' },
      { id: 'ph-dev', name: 'Développement', col: 1, row: 3, forEach: 'chaque Ticket prêt' },
    ]);
    expect(stepsOf(data)).toHaveLength(17);
    expect(data.phases.find((phase) => phase.id === 'ph-dev')?.steps.map((step) => [step.id, step.col, step.row])).toEqual([
      ['st-code', 1, 1],
      ['st-checks', 2, 1],
      ['st-review', 3, 1],
      ['st-rv', 3, 2],
      ['st-merge', 4, 1],
    ]);
    expect(data.arrows).toHaveLength(25);
    expect(data.arrows[0]).toEqual({ from: { stepId: 'st-analyse', portId: 'idee' }, to: { stepId: 'st-tri', portId: 'idee' }, state: null });
    expect(data.loopBacks).toEqual(PROCESS_CREWDECK.loopBacks.map((loop) => ({ ...loop, state: null })));
  });

  it('names each Étape by its family, with the catalogue’s exceptions', () => {
    const data = canvasOf(PROCESS_CREWDECK, [], null, CONTEXT);
    const kind = (id: string) => ({ variant: stepOf(data, id).variant, kindLabel: stepOf(data, id).kindLabel, judges: stepOf(data, id).judges });

    expect(kind('st-analyse')).toEqual({ variant: 'agent', kindLabel: 'Agent', judges: false });
    expect(kind('st-tri')).toEqual({ variant: 'gate', kindLabel: 'Pilote', judges: false });
    expect(kind('st-rc-prd')).toEqual({ variant: 'agent', kindLabel: 'Revue croisée', judges: true });
    expect(kind('st-review')).toEqual({ variant: 'agent', kindLabel: 'Agent', judges: true });
    expect(kind('st-checks')).toEqual({ variant: 'core', kindLabel: 'CI du dépôt', judges: false });
    expect(kind('st-merge')).toEqual({ variant: 'core', kindLabel: 'par la Boucle', judges: false });
  });

  it('says « Commandes » for Checks without the Connecteur, « Commande » for a Commande, and « Crewdeck » for a Merge outside a Ticket’s Phase', () => {
    const definition = crewdeck((draft) => {
      const checks = draft.steps.find((step) => step.id === 'st-checks')!;
      checks.tools = [{ kind: 'command', commandId: 'tests' }];
      draft.commands.push({ id: 'tests' });
      draft.phases.find((phase) => phase.id === 'ph-dev')!.forEach = null;
      draft.phases.push({ id: 'ph-livraison', name: 'Livraison', col: 2, row: 3, forEach: null });
      draft.steps.push({
        id: 'st-lancer',
        phaseId: 'ph-livraison',
        kind: 'command',
        name: 'Lancer',
        col: 1,
        row: 1,
        inputs: [{ id: 'changement', type: 'code-change', note: 'mergé' }],
        outputs: [{ id: 'livraison', type: 'delivery' }],
        tools: [{ kind: 'command', commandId: 'lancer' }],
      });
    });
    const data = canvasOf(definition, [], null, CONTEXT);

    expect(stepOf(data, 'st-checks').kindLabel).toBe('Commandes');
    expect(stepOf(data, 'st-checks').tools).toEqual([{ kind: 'command', label: 'Commande' }]);
    expect(stepOf(data, 'st-merge').kindLabel).toBe('Crewdeck');
    expect({ variant: stepOf(data, 'st-lancer').variant, kindLabel: stepOf(data, 'st-lancer').kindLabel }).toEqual({ variant: 'command', kindLabel: 'Commande' });
  });

  it('labels each port by its Type d’artefact with its note, and each Outil by its name', () => {
    const definition = crewdeck((draft) => {
      draft.steps.find((step) => step.id === 'st-maquettes')!.tools.push({ kind: 'mcp', name: 'stitch' });
    });
    const data = canvasOf(definition, [], null, { ...CONTEXT, roleNames: {} });

    expect(stepOf(data, 'st-review').ports).toEqual([
      { id: 'changement', dir: 'in', type: 'code-change', label: 'Changement de code', note: null, state: null },
      { id: 'verdict', dir: 'in', type: 'verdict', label: 'Verdict', note: 'des checks', state: null },
      { id: 'verdict', dir: 'out', type: 'verdict', label: 'Verdict', note: null, state: null },
    ]);
    expect(stepOf(data, 'st-analyse').tools).toEqual([
      { kind: 'role', label: 'Idée' },
      { kind: 'skill', label: 'idea-analysis' },
    ]);
    expect(stepOf(data, 'st-maquettes').tools).toEqual([
      { kind: 'role', label: 'Conception' },
      { kind: 'skill', label: 'visual-design' },
      { kind: 'mcp', label: 'stitch' },
    ]);
    expect(stepOf(data, 'st-checks').tools).toEqual([{ kind: 'connector', label: 'GitHub' }]);
  });

  it('names a Rôle of the Pilote’s by its name', () => {
    const definition = crewdeck((draft) => {
      draft.steps.find((step) => step.id === 'st-code')!.tools[0] = { kind: 'role', roleId: 'r-0000front' };
    });
    const data = canvasOf(definition, [], null, { ...CONTEXT, roleNames: { 'r-0000front': 'Front' } });

    expect(stepOf(data, 'st-code').tools[0]).toEqual({ kind: 'role', label: 'Front' });
  });

  it('marks an unfed Entrée and counts the Manques on their Étape and their Phase', () => {
    const definition = crewdeck((draft) => {
      draft.arrows = draft.arrows.filter((arrow) => !(arrow.to.stepId === 'st-merge' && arrow.to.portId === 'v-review'));
    });
    const gaps = findGaps(definition, GITHUB);
    const data = canvasOf(definition, gaps, null, CONTEXT);

    expect(gaps).toHaveLength(3);
    expect(stepOf(data, 'st-merge').gaps).toBe(3);
    expect(stepOf(data, 'st-merge').ports.find((port) => port.id === 'v-review')?.state).toBe('unfed');
    expect(stepOf(data, 'st-merge').ports.find((port) => port.id === 'v-rv')?.state).toBeNull();
    expect(data.phases.map((phase) => phase.gaps)).toEqual([0, 0, 3]);
    expect(stepOf(data, 'st-code').gaps).toBe(0);
  });

  it('marks the block selected, and passes the block to centre', () => {
    const step = canvasOf(PROCESS_CREWDECK, [], { kind: 'step', id: 'st-review' }, { ...CONTEXT, focus: { id: 'st-review', at: 2 } });
    expect(stepsOf(step).filter((candidate) => candidate.selected).map((candidate) => candidate.id)).toEqual(['st-review']);
    expect(step.phases.some((phase) => phase.selected)).toBe(false);
    expect(step.focus).toEqual({ id: 'st-review', at: 2 });

    const phase = canvasOf(PROCESS_CREWDECK, [], { kind: 'phase', id: 'ph-dev' }, CONTEXT);
    expect(phase.phases.map((candidate) => candidate.selected)).toEqual([false, false, true]);
    expect(stepsOf(phase).some((candidate) => candidate.selected)).toBe(false);
    expect(phase.focus).toBeNull();
  });

  it('gives the canvas the ports of every Type d’artefact', () => {
    expect([...PORT_TYPES]).toEqual([...ARTIFACT_TYPES]);
  });
});

describe('editing the canvas', () => {
  it('is editable when asked, the target Phase outlined', () => {
    const data = canvasOf(PROCESS_CREWDECK, [], null, { ...CONTEXT, editable: true, target: 'ph-conception' });
    expect(data.editable).toBe(true);
    expect(data.phases.map((phase) => phase.target)).toEqual([false, true, false]);
  });

  it('draws the selected Phase, when it is the target, as the target only, as the mockup does', () => {
    const data = canvasOf(PROCESS_CREWDECK, [], { kind: 'phase', id: 'ph-dev' }, { ...CONTEXT, editable: true, target: 'ph-dev' });
    expect(data.phases.map((phase) => [phase.target, phase.selected])).toEqual([
      [false, false],
      [false, false],
      [true, false],
    ]);
    expect(canvasOf(PROCESS_CREWDECK, [], { kind: 'phase', id: 'ph-dev' }, CONTEXT).phases[2]?.selected).toBe(true);
  });

  it('targets the selected Phase, else the selected Étape’s, else the last one', () => {
    expect(targetPhaseOf(PROCESS_CREWDECK, { kind: 'phase', id: 'ph-idee' })?.id).toBe('ph-idee');
    expect(targetPhaseOf(PROCESS_CREWDECK, { kind: 'step', id: 'st-prd' })?.id).toBe('ph-conception');
    expect(targetPhaseOf(PROCESS_CREWDECK, { kind: 'sources', id: null })?.id).toBe('ph-dev');
    expect(targetPhaseOf(PROCESS_CREWDECK, null)?.id).toBe('ph-dev');
  });
});
