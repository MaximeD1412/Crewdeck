import { defaultStep, type StepKind } from '../../src/process/catalogue.js';
import { LOOP_BACK_MAX_DEFAULT, type Phase, type Port, type ProcessDefinition, type Step } from '../../src/process/definition.js';
import type { ProcessGap, ProcessGapKind, Refusal, RefusalKind } from '../../src/process/gaps.js';
import type { ProcessSources } from '../../src/process/sources.js';
import { PROCESS_CREWDECK } from '../../src/process/templates/process-crewdeck.js';

/**
 * The canvas's rules on one set of fixtures (ADR 0011, « Manques »): each
 * case a named change of « Process Crewdeck », its Sources, and what
 * `validateDefinition` and `findGaps` give for it. `contracts:generate`
 * writes each to `<name>.json` here; the page's and the server's tests read
 * the same files. `gaps` is `null` when the definition has a refusal:
 * `findGaps` only reads what `validateDefinition` accepts.
 */
export interface ProcessCase {
  readonly name: string;
  readonly change: string;
  readonly definition: ProcessDefinition;
  readonly sources: ProcessSources;
  readonly refusals: readonly Refusal[];
  readonly gaps: readonly ProcessGap[] | null;
}

const GITHUB: ProcessSources = { ticket: 'github', code: 'github' };
const LOCAL: ProcessSources = { ticket: 'local', code: 'local' };

type Draft = ProcessDefinition;

/** « Process Crewdeck » with `edits` applied, in order, to a copy. */
const crewdeck = (...edits: ((draft: Draft) => void)[]): ProcessDefinition => {
  const draft = structuredClone(PROCESS_CREWDECK);
  for (const edit of edits) edit(draft);
  return draft;
};

const stepOf = (draft: Draft, id: string): Step => {
  const step = draft.steps.find((candidate) => candidate.id === id);
  if (step === undefined) throw new Error(`no Étape ${id}`);
  return step;
};

const editPhase = (id: string, edit: Partial<Phase>) => (draft: Draft) => {
  const phase = draft.phases.find((candidate) => candidate.id === id);
  if (phase === undefined) throw new Error(`no Phase ${id}`);
  Object.assign(phase, edit);
};

/** `'st-prd.prd → st-rc-prd.document'`. */
const parseArrow = (text: string) => {
  const [from, to] = text.split(' → ').map((end) => {
    const [stepId, portId] = end.split('.') as [string, string];
    return { stepId, portId };
  }) as [{ stepId: string; portId: string }, { stepId: string; portId: string }];
  return { from, to };
};
const sameArrow = (text: string) => {
  const { from, to } = parseArrow(text);
  return (arrow: Draft['arrows'][number]) =>
    arrow.from.stepId === from.stepId && arrow.from.portId === from.portId && arrow.to.stepId === to.stepId && arrow.to.portId === to.portId;
};

const addArrow = (text: string) => (draft: Draft) => {
  draft.arrows.push(parseArrow(text));
};
const removeArrow = (text: string) => (draft: Draft) => {
  const index = draft.arrows.findIndex(sameArrow(text));
  if (index < 0) throw new Error(`no arrow ${text}`);
  draft.arrows.splice(index, 1);
};
const addLoopBack = (text: string) => (draft: Draft) => {
  const [from, to] = text.split(' → ') as [string, string];
  draft.loopBacks.push({ from, to, max: LOOP_BACK_MAX_DEFAULT });
};

/** As the canvas removes an Étape: with its arrows and its Retours. */
const dropSteps = (draft: Draft, ids: ReadonlySet<string>) => {
  draft.steps = draft.steps.filter((step) => !ids.has(step.id));
  draft.arrows = draft.arrows.filter((arrow) => !ids.has(arrow.from.stepId) && !ids.has(arrow.to.stepId));
  draft.loopBacks = draft.loopBacks.filter((loopBack) => !ids.has(loopBack.from) && !ids.has(loopBack.to));
};
const removeStep = (id: string) => (draft: Draft) => dropSteps(draft, new Set([id]));
/** As the canvas removes a Phase: with its Étapes. */
const removePhase = (id: string) => (draft: Draft) => {
  draft.phases = draft.phases.filter((phase) => phase.id !== id);
  dropSteps(draft, new Set(draft.steps.filter((step) => step.phaseId === id).map((step) => step.id)));
};

/** As the canvas adds an Étape from the catalogue: its kind's defaults, then `override`. */
const addStep =
  (kind: StepKind, id: string, phaseId: string, [col, row]: [number, number], override: Partial<Step> = {}) =>
  (draft: Draft) => {
    draft.steps.push({ ...defaultStep(kind, { id, phaseId, col, row }), ...override });
  };
const editStep = (id: string, edit: (step: Step) => void) => (draft: Draft) => edit(stepOf(draft, id));
const addInput = (stepId: string, port: Port) => editStep(stepId, (step) => step.inputs.push(port));

const refusal = (kind: RefusalKind, target: string, label: string): Refusal => ({ kind, target, label });
const gap = (kind: ProcessGapKind, target: string, label: string): ProcessGap => ({ kind, target, label });

const refused = (name: string, change: string, definition: ProcessDefinition, ...refusals: Refusal[]): ProcessCase => ({
  name,
  change,
  definition,
  sources: GITHUB,
  refusals,
  gaps: null,
});
const accepted = (name: string, change: string, definition: ProcessDefinition, sources: ProcessSources, ...gaps: ProcessGap[]): ProcessCase => ({
  name,
  change,
  definition,
  sources,
  refusals: [],
  gaps,
});

const CORE_MISSING = '« Checks », « Merge » et une Review sont dans chaque Process : ils ne se retirent pas';
const CYCLE = 'Cette flèche ferait une boucle : une boucle n’existe que comme Retour, avec son maximum.';
const CHECKS_NEED = '« Checks » a besoin de la CI du dépôt ou d’une Commande : aucun Outil attaché n’en donne';
const E2E = 'Tests de bout en bout';
/** A Commande Étape « Tests de bout en bout » fed by the Code. */
const withE2e = (override: Partial<Step> = {}) => [
  addStep('command', 'st-e2e', 'ph-dev', [2, 2], { name: E2E, ...override }),
  addArrow('st-code.changement → st-e2e.changement'),
];

export const PROCESS_CASES: readonly ProcessCase[] = [
  // « Process Crewdeck » itself.
  accepted('crewdeck-github', '« Process Crewdeck », both groups on GitHub', crewdeck(), GITHUB),
  accepted(
    'crewdeck-local',
    '« Process Crewdeck », both groups Local: the GitHub Connecteur gives no CI',
    crewdeck(),
    LOCAL,
    gap('capability.missing', 'steps.st-checks', CHECKS_NEED),
  ),

  // The refusals.
  refused(
    'id-duplicate-step',
    'add an Étape `code` with the id st-code',
    crewdeck(addStep('code', 'st-code', 'ph-dev', [1, 2])),
    refusal('id.duplicate', 'steps.st-code', '« Code » reprend l’identifiant « st-code » de « Code »'),
  ),
  refused(
    'id-duplicate-phase',
    'add a Phase with the id st-code',
    crewdeck((draft) => draft.phases.push({ id: 'st-code', name: 'Livraison', col: 1, row: 4, forEach: null })),
    refusal('id.duplicate', 'steps.st-code', '« Code » reprend l’identifiant « st-code » de « Livraison »'),
  ),
  refused(
    'id-duplicate-port',
    'add a second Entrée v-review to st-merge',
    crewdeck(addInput('st-merge', { id: 'v-review', type: 'verdict' })),
    refusal('id.duplicate', 'steps.st-merge.inputs.v-review', '« Merge » a deux Entrées « v-review »'),
  ),
  refused(
    'ref-unknown-phase',
    'add an Étape `inventory` in a Phase ph-qa that does not exist',
    crewdeck(addStep('inventory', 'st-inventaire', 'ph-qa', [1, 1])),
    refusal('ref.unknown', 'steps.st-inventaire', '« Inventaire » est dans une Phase qui n’existe pas : « ph-qa »'),
  ),
  refused(
    'ref-unknown-arrow-step',
    'add an arrow st-code.changement → st-deploy.changement, an Étape that does not exist',
    crewdeck(addArrow('st-code.changement → st-deploy.changement')),
    refusal('ref.unknown', 'arrows.25', 'Cette flèche va vers une Étape qui n’existe pas : « st-deploy »'),
  ),
  refused(
    'ref-unknown-arrow-port',
    'add an arrow st-rv.verdict → st-merge.v-qa, an Entrée st-merge does not have',
    crewdeck(addArrow('st-rv.verdict → st-merge.v-qa')),
    refusal('ref.unknown', 'arrows.25', 'Cette flèche va vers une Entrée que « Merge » n’a pas : « v-qa »'),
  ),
  refused(
    'ref-unknown-loop-back',
    'add a Retour st-review → st-deploy, an Étape that does not exist',
    crewdeck(addLoopBack('st-review → st-deploy')),
    refusal('ref.unknown', 'loopBacks.8', 'Ce Retour va vers une Étape qui n’existe pas : « st-deploy »'),
  ),
  refused(
    'ref-unknown-command',
    'give st-checks a `command` Outil naming e2e, which is not in `commands`',
    crewdeck(editStep('st-checks', (step) => step.tools.push({ kind: 'command', commandId: 'e2e' }))),
    refusal('ref.unknown', 'steps.st-checks', '« Checks » lance une Commande qui n’existe pas : « e2e »'),
  ),
  refused(
    'position-taken-phase',
    'move the Phase ph-dev onto ph-conception’s cell',
    crewdeck(editPhase('ph-dev', { col: 1, row: 2 })),
    refusal('position.taken', 'phases.ph-dev', '« Développement » est sur la case de « Conception »'),
  ),
  refused(
    'position-taken-step',
    'move st-rv onto st-review’s cell',
    crewdeck(editStep('st-rv', (step) => Object.assign(step, { col: 3, row: 1 }))),
    refusal('position.taken', 'steps.st-rv', '« Revue visuelle » est sur la case de « Review »'),
  ),
  refused(
    'for-each-duplicate',
    'repeat ph-dev for each Idée retenue, as ph-conception',
    crewdeck(editPhase('ph-dev', { forEach: 'idea.retained' })),
    refusal('for-each.duplicate', 'phases.ph-dev', '« Développement » se répète pour chaque Idée retenue, comme « Conception »'),
  ),
  refused(
    'step-ports-type',
    'add an Entrée Verdict to st-code, which takes none',
    crewdeck(addInput('st-code', { id: 'verdict', type: 'verdict' })),
    refusal('step.ports', 'steps.st-code.inputs.verdict', '« Code » ne prend pas d’Entrée Verdict'),
  ),
  refused(
    'step-ports-same-type',
    'add an Approbation whose Entrée is an Inventaire and whose Sortie a PRD',
    crewdeck(
      addStep('approval', 'st-ap-inventaire', 'ph-conception', [6, 1], {
        name: 'Approbation de l’Inventaire',
        inputs: [{ id: 'document', type: 'inventory' }],
        outputs: [{ id: 'document', type: 'prd' }],
      }),
    ),
    refusal('step.ports', 'steps.st-ap-inventaire.outputs.document', '« Approbation de l’Inventaire » rend son Entrée « document » : sa Sortie « document » prend le type Inventaire'),
  ),
  refused(
    'step-ports-missing',
    'remove the Entrée changement of st-merge, and its arrow',
    crewdeck(
      removeArrow('st-code.changement → st-merge.changement'),
      editStep('st-merge', (step) => step.inputs.splice(0, 1)),
    ),
    refusal('step.ports', 'steps.st-merge.inputs.changement', '« Merge » n’a plus son Entrée « changement »'),
  ),
  refused(
    'step-tools-not-agent',
    'give st-checks a Rôle',
    crewdeck(editStep('st-checks', (step) => step.tools.push({ kind: 'role', roleId: 'code' }))),
    refusal('step.tools', 'steps.st-checks', '« Checks » n’est pas l’Étape d’un agent : ni Rôle ni Skill'),
  ),
  refused(
    'step-tools-two-roles',
    'give st-code a second Rôle',
    crewdeck(editStep('st-code', (step) => step.tools.push({ kind: 'role', roleId: 'review' }))),
    refusal('step.tools', 'steps.st-code', '« Code » a deux Rôles : un seul par Étape'),
  ),
  refused(
    'step-tools-two-skills',
    'give st-code a second Skill',
    crewdeck(editStep('st-code', (step) => step.tools.push({ kind: 'skill', skillId: 'review' }))),
    refusal('step.tools', 'steps.st-code', '« Code » a deux Skills : un seul par Étape'),
  ),
  refused(
    'arrow-direction',
    'add an arrow st-merge.changement → st-code.changement, a Sortie',
    crewdeck(addArrow('st-merge.changement → st-code.changement')),
    refusal('arrow.direction', 'arrows.25', 'Une flèche va d’une Sortie vers une Entrée'),
  ),
  refused(
    'arrow-type-mismatch',
    'add an arrow st-merge.changement → st-code.ticket',
    crewdeck(addArrow('st-merge.changement → st-code.ticket')),
    refusal('arrow.type-mismatch', 'arrows.25', 'Une Sortie Changement de code ne va que vers une Entrée Changement de code'),
  ),
  refused(
    'arrow-cycle-self',
    'add a second Entrée Verdict v-autre to st-review, and an arrow st-review.verdict → st-review.v-autre',
    crewdeck(addInput('st-review', { id: 'v-autre', type: 'verdict' }), addArrow('st-review.verdict → st-review.v-autre')),
    refusal('arrow.cycle', 'arrows.25', CYCLE),
  ),
  refused(
    'arrow-cycle',
    'add a Review st-review-2 after the Merge, whose Verdict goes back to a second Entrée v-autre of st-review',
    crewdeck(
      addStep('review', 'st-review-2', 'ph-dev', [5, 1], { name: 'Review du merge' }),
      addArrow('st-merge.changement → st-review-2.changement'),
      addInput('st-review', { id: 'v-autre', type: 'verdict' }),
      addArrow('st-review-2.verdict → st-review.v-autre'),
    ),
    refusal('arrow.cycle', 'arrows.26', CYCLE),
  ),
  refused(
    'input-many-arrows',
    'add a second arrow into st-merge.v-review, st-rv.verdict → st-merge.v-review',
    crewdeck(addArrow('st-rv.verdict → st-merge.v-review')),
    refusal('input.many-arrows', 'arrows.25', 'L’Entrée « Verdict de la Review » de « Merge » a déjà sa flèche'),
  ),
  refused(
    'loop-back-not-judging',
    'add a Retour st-code → st-checks',
    crewdeck(addLoopBack('st-code → st-checks')),
    refusal('loop-back.not-judging', 'loopBacks.8', '« Code » ne juge pas : un Retour part d’une Étape qui juge'),
  ),
  refused(
    'loop-back-other-phase',
    'add a Retour st-review → st-prd',
    crewdeck(addLoopBack('st-review → st-prd')),
    refusal('loop-back.other-phase', 'loopBacks.8', 'Un Retour reste dans sa Phase : « PRD » n’est pas dans « Développement »'),
  ),
  refused(
    'loop-back-not-before',
    'add a Retour st-rc-prd → st-ap-prd',
    crewdeck(addLoopBack('st-rc-prd → st-ap-prd')),
    refusal('loop-back.not-before', 'loopBacks.8', 'Un Retour revient en arrière : « Approbation du PRD » ne vient pas avant « Revue croisée du PRD »'),
  ),
  refused(
    'loop-back-to-itself',
    'add a Retour st-review → st-review',
    crewdeck(addLoopBack('st-review → st-review')),
    refusal('loop-back.not-before', 'loopBacks.8', 'Un Retour revient en arrière : « Review » ne vient pas avant « Review »'),
  ),
  refused(
    'loop-back-many',
    'add a second Retour from st-ap-prd, st-ap-prd → st-rc-prd',
    crewdeck(addLoopBack('st-ap-prd → st-rc-prd')),
    refusal('loop-back.many', 'loopBacks.8', '« Approbation du PRD » a déjà son Retour'),
  ),
  refused('core-missing-checks', 'remove the Étape st-checks', crewdeck(removeStep('st-checks')), refusal('core.missing', 'steps', CORE_MISSING)),
  refused('core-missing-review', 'remove the Étape st-review, the only Review', crewdeck(removeStep('st-review')), refusal('core.missing', 'steps', CORE_MISSING)),
  refused('core-missing-phase', 'remove the Phase ph-dev, with its Étapes', crewdeck(removePhase('ph-dev')), refusal('core.missing', 'steps', CORE_MISSING)),
  refused(
    'core-duplicate',
    'add a second Étape `merge`',
    crewdeck(addStep('merge', 'st-merge-2', 'ph-dev', [5, 1])),
    refusal('core.duplicate', 'steps.st-merge-2', 'Un Process n’a qu’une Étape « Merge »'),
  ),
  refused(
    'refusals-combined',
    'move st-rv onto st-review’s cell, and add an arrow st-merge.changement → st-code.ticket',
    crewdeck(editStep('st-rv', (step) => Object.assign(step, { col: 3, row: 1 })), addArrow('st-merge.changement → st-code.ticket')),
    refusal('position.taken', 'steps.st-rv', '« Revue visuelle » est sur la case de « Review »'),
    refusal('arrow.type-mismatch', 'arrows.25', 'Une Sortie Changement de code ne va que vers une Entrée Changement de code'),
  ),

  // The Manques.
  accepted(
    'input-unfed',
    'remove the arrow st-rv.verdict → st-merge.v-rv',
    crewdeck(removeArrow('st-rv.verdict → st-merge.v-rv')),
    GITHUB,
    gap('input.unfed', 'steps.st-merge.inputs.v-rv', 'Entrée « Verdict de la Revue visuelle » de « Merge » : rien ne l’alimente'),
  ),
  accepted(
    'input-fed-by-for-each',
    'remove the arrow st-ap-tickets.document → st-code.ticket: ph-dev repeats for each Ticket prêt',
    crewdeck(removeArrow('st-ap-tickets.document → st-code.ticket')),
    GITHUB,
  ),
  accepted(
    'merge-without-review',
    'remove the arrow st-review.verdict → st-merge.v-review',
    crewdeck(removeArrow('st-review.verdict → st-merge.v-review')),
    GITHUB,
    gap('input.unfed', 'steps.st-merge.inputs.v-review', 'Entrée « Verdict de la Review » de « Merge » : rien ne l’alimente'),
    gap('merge.no-review', 'steps.st-merge', '« Merge » merge un Changement de code sans Review avant lui'),
    gap('merge.no-checks', 'steps.st-merge', '« Merge » merge un Changement de code sans checks avant lui'),
  ),
  accepted(
    'merge-no-review',
    'feed st-merge.v-review from the checks instead of the Review',
    crewdeck(removeArrow('st-review.verdict → st-merge.v-review'), addArrow('st-checks.verdict → st-merge.v-review')),
    GITHUB,
    gap('merge.no-review', 'steps.st-merge', '« Merge » merge un Changement de code sans Review avant lui'),
  ),
  accepted(
    'merge-no-checks',
    'remove the Entrée verdict of st-review, and its arrow from the checks',
    crewdeck(removeArrow('st-checks.verdict → st-review.verdict'), editStep('st-review', (step) => step.inputs.splice(1, 1))),
    GITHUB,
    gap('merge.no-checks', 'steps.st-merge', '« Merge » merge un Changement de code sans checks avant lui'),
  ),
  accepted(
    'source-missing',
    'no Source for the Tickets',
    crewdeck(),
    { ticket: null, code: 'github' },
    gap('source.missing', 'sources.ticket', 'Ticket : aucune Source'),
  ),
  accepted(
    'capability-missing-command',
    'add a Commande Étape « Tests de bout en bout » without a `command` Outil',
    crewdeck(...withE2e()),
    GITHUB,
    gap('capability.missing', 'steps.st-e2e', `« ${E2E} » a besoin d’une Commande : aucun Outil attaché n’en donne`),
  ),
  accepted(
    'capability-command',
    'add a Commande Étape « Tests de bout en bout » with its `command` Outil',
    crewdeck(...withE2e({ tools: [{ kind: 'command', commandId: 'e2e' }] }), (draft) => draft.commands.push({ id: 'e2e' })),
    GITHUB,
  ),
  accepted(
    'capability-missing-role',
    'remove the Rôle of st-code',
    crewdeck(editStep('st-code', (step) => (step.tools = step.tools.filter((tool) => tool.kind !== 'role')))),
    GITHUB,
    gap('capability.missing', 'steps.st-code', '« Code » a besoin d’un Rôle : aucun Outil attaché n’en donne'),
  ),
  accepted(
    'checks-local-command',
    'give st-checks a `command` Outil, the code’s Source Local',
    crewdeck(editStep('st-checks', (step) => step.tools.push({ kind: 'command', commandId: 'checks' })), (draft) => draft.commands.push({ id: 'checks' })),
    { ticket: 'github', code: 'local' },
  ),
  accepted(
    'gaps-no-sources',
    '« Process Crewdeck » without any Source',
    crewdeck(),
    { ticket: null, code: null },
    gap('capability.missing', 'steps.st-checks', CHECKS_NEED),
    gap('source.missing', 'sources.prd', 'PRD : aucune Source'),
    gap('source.missing', 'sources.mockups', 'Maquettes : aucune Source'),
    gap('source.missing', 'sources.technical-design', 'Conception technique : aucune Source'),
    gap('source.missing', 'sources.ticket', 'Ticket : aucune Source'),
    gap('source.missing', 'sources.code-change', 'Changement de code : aucune Source'),
    gap('source.missing', 'sources.verdict', 'Verdict : aucune Source'),
  ),
];
