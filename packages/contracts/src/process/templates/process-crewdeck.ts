import type { ArtifactType } from '../artifact-types.js';
import { CATALOGUE, defaultStep, type StepKind } from '../catalogue.js';
import { type Arrow, LOOP_BACK_MAX_DEFAULT, type LoopBack, type Port, type ProcessDefinition, type Step, type Tool, zProcessDefinition } from '../definition.js';

/**
 * « Process Crewdeck » (US-97), the Modèle de process of the release, from
 * `design/screens/gestion-du-process/process.html`: data, not a row. Its ids
 * are stable across releases, so that a diff and a pinned run name the same
 * Étape whatever the version.
 */
export const PROCESS_CREWDECK_NAME = 'Process Crewdeck';

const port = (id: string, type: ArtifactType, note?: string): Port => ({ id, type, ...(note === undefined ? {} : { note }) });

/** An Étape of `kind` with its own name and ports; an agent's Outils are its kind's Rôle and Skill (`defaultStep`'s). */
const step = (
  id: string,
  phaseId: string,
  kind: StepKind,
  name: string,
  [col, row]: [number, number],
  inputs: Port[],
  outputs: Port[],
  tools: Tool[] = [],
): Step => ({
  ...defaultStep(kind, { id, phaseId, col, row }),
  name,
  inputs,
  outputs,
  ...(CATALOGUE[kind].family === 'agent' ? {} : { tools }),
});

/** `'st-prd.prd'` → `'st-rc-prd.document'`. */
const arrow = (from: string, to: string): Arrow => {
  const end = (ref: string) => {
    const [stepId, portId] = ref.split('.') as [string, string];
    return { stepId, portId };
  };
  return { from: end(from), to: end(to) };
};

const loopBack = (from: string, to: string): LoopBack => ({ from, to, max: LOOP_BACK_MAX_DEFAULT });

export const PROCESS_CREWDECK: ProcessDefinition = zProcessDefinition.parse({
  schemaVersion: 1,
  phases: [
    { id: 'ph-idee', name: 'Idée', col: 1, row: 1, forEach: 'idea.noted' },
    { id: 'ph-conception', name: 'Conception', col: 1, row: 2, forEach: 'idea.retained' },
    { id: 'ph-dev', name: 'Développement', col: 1, row: 3, forEach: 'ticket.ready' },
  ],
  steps: [
    step('st-analyse', 'ph-idee', 'idea-analysis', 'Analyse de l’Idée', [1, 1], [port('idee', 'idea', 'notée par toi')], [port('idee', 'idea')]),
    step('st-tri', 'ph-idee', 'idea-triage', 'Tri de l’Idée', [2, 1], [port('idee', 'idea')], [port('idee', 'idea', 'retenue')]),

    step('st-prd', 'ph-conception', 'prd', 'PRD', [1, 1], [port('idee', 'idea')], [port('prd', 'prd')]),
    step('st-rc-prd', 'ph-conception', 'cross-review', 'Revue croisée du PRD', [2, 1], [port('document', 'prd')], [port('verdict', 'verdict')]),
    step('st-ap-prd', 'ph-conception', 'approval', 'Approbation du PRD', [3, 1], [port('document', 'prd'), port('verdict', 'verdict')], [port('document', 'prd')]),
    step('st-maquettes', 'ph-conception', 'mockups', 'Maquettes', [4, 1], [port('prd', 'prd')], [port('maquettes', 'mockups')]),
    step('st-ap-maquettes', 'ph-conception', 'approval', 'Revue des maquettes', [5, 1], [port('document', 'mockups')], [port('document', 'mockups')]),
    step(
      'st-ct',
      'ph-conception',
      'technical-design',
      'Conception technique',
      [1, 2],
      [port('prd', 'prd'), port('maquettes', 'mockups')],
      [port('conception', 'technical-design')],
    ),
    step('st-rc-ct', 'ph-conception', 'cross-review', 'Revue croisée de la conception', [2, 2], [port('document', 'technical-design')], [port('verdict', 'verdict')]),
    step(
      'st-ap-ct',
      'ph-conception',
      'approval',
      'Approbation de la conception',
      [3, 2],
      [port('document', 'technical-design'), port('verdict', 'verdict')],
      [port('document', 'technical-design')],
    ),
    step(
      'st-decoupage',
      'ph-conception',
      'split',
      'Découpage en Tickets',
      [4, 2],
      [port('prd', 'prd'), port('maquettes', 'mockups'), port('conception', 'technical-design')],
      [port('ticket', 'ticket')],
    ),
    step('st-ap-tickets', 'ph-conception', 'approval', 'Validation des Tickets', [5, 2], [port('document', 'ticket')], [port('document', 'ticket', 'prêt')]),

    step('st-code', 'ph-dev', 'code', 'Code', [1, 1], [port('ticket', 'ticket')], [port('changement', 'code-change')]),
    step('st-checks', 'ph-dev', 'checks', 'Checks', [2, 1], [port('changement', 'code-change')], [port('verdict', 'verdict')], [{ kind: 'connector', connector: 'github' }]),
    step('st-review', 'ph-dev', 'review', 'Review', [3, 1], [port('changement', 'code-change'), port('verdict', 'verdict', 'des checks')], [port('verdict', 'verdict')]),
    step('st-rv', 'ph-dev', 'visual-review', 'Revue visuelle', [3, 2], [port('changement', 'code-change'), port('maquettes', 'mockups')], [port('verdict', 'verdict')]),
    step(
      'st-merge',
      'ph-dev',
      'merge',
      'Merge',
      [4, 1],
      [port('changement', 'code-change'), port('v-review', 'verdict', 'de la Review'), port('v-rv', 'verdict', 'de la Revue visuelle')],
      [port('changement', 'code-change', 'mergé')],
    ),
  ],
  arrows: [
    arrow('st-analyse.idee', 'st-tri.idee'),
    arrow('st-tri.idee', 'st-prd.idee'),
    arrow('st-prd.prd', 'st-rc-prd.document'),
    arrow('st-prd.prd', 'st-ap-prd.document'),
    arrow('st-rc-prd.verdict', 'st-ap-prd.verdict'),
    arrow('st-ap-prd.document', 'st-maquettes.prd'),
    arrow('st-maquettes.maquettes', 'st-ap-maquettes.document'),
    arrow('st-ap-prd.document', 'st-ct.prd'),
    arrow('st-ap-maquettes.document', 'st-ct.maquettes'),
    arrow('st-ct.conception', 'st-rc-ct.document'),
    arrow('st-ct.conception', 'st-ap-ct.document'),
    arrow('st-rc-ct.verdict', 'st-ap-ct.verdict'),
    arrow('st-ap-prd.document', 'st-decoupage.prd'),
    arrow('st-ap-maquettes.document', 'st-decoupage.maquettes'),
    arrow('st-ap-ct.document', 'st-decoupage.conception'),
    arrow('st-decoupage.ticket', 'st-ap-tickets.document'),
    arrow('st-ap-tickets.document', 'st-code.ticket'),
    arrow('st-code.changement', 'st-checks.changement'),
    arrow('st-code.changement', 'st-review.changement'),
    arrow('st-checks.verdict', 'st-review.verdict'),
    arrow('st-code.changement', 'st-rv.changement'),
    arrow('st-ap-maquettes.document', 'st-rv.maquettes'),
    arrow('st-code.changement', 'st-merge.changement'),
    arrow('st-review.verdict', 'st-merge.v-review'),
    arrow('st-rv.verdict', 'st-merge.v-rv'),
  ],
  loopBacks: [
    loopBack('st-rc-prd', 'st-prd'),
    loopBack('st-rc-ct', 'st-ct'),
    loopBack('st-review', 'st-code'),
    loopBack('st-rv', 'st-code'),
    // Every approval gate sends its document back to the Étape that wrote it (US-11).
    loopBack('st-ap-prd', 'st-prd'),
    loopBack('st-ap-maquettes', 'st-maquettes'),
    loopBack('st-ap-ct', 'st-ct'),
    loopBack('st-ap-tickets', 'st-decoupage'),
  ],
  commands: [],
});

/** The Modèles de process of the release, by id. */
export const BUILTIN_TEMPLATES: Readonly<Record<'process-crewdeck', ProcessDefinition>> = { 'process-crewdeck': PROCESS_CREWDECK };
