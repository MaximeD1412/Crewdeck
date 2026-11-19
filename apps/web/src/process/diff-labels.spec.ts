import { diffDefinitions, PROCESS_CHANGE_KINDS, PROCESS_CREWDECK, type ProcessChange, type ProcessDefinition, type Tool } from '@crewdeck/contracts';
import { changeLabel, changeLabels } from './diff-labels.js';

const step = (id: string, name: string) => ({ id, name });
const MAQUETTES = step('st-maquettes', 'Maquettes');
const REVIEW = step('st-review', 'Review');
const CODE = step('st-code', 'Code');
const MERGE = { stepId: 'st-merge', portId: 'v-review', name: 'Merge' };
const REVIEW_END = { stepId: 'st-review', portId: 'verdict', name: 'Review' };
const DEV = step('ph-dev', 'Développement');

/** One change of each kind, in the order of the kinds. */
const ONE_OF_EACH: readonly ProcessChange[] = [
  { kind: 'phase.added', phase: step('ph-livraison', 'Livraison') },
  { kind: 'phase.removed', phase: step('ph-qa', 'Qualité') },
  { kind: 'phase.renamed', phaseId: 'ph-dev', from: 'Développement', to: 'Réalisation' },
  { kind: 'phase.for-each-changed', phase: DEV, from: 'ticket.ready', to: null },
  { kind: 'step.added', step: step('st-inventaire', 'Inventaire'), phase: step('ph-conception', 'Conception') },
  { kind: 'step.removed', step: step('st-rv', 'Revue visuelle'), phase: DEV },
  { kind: 'step.moved', step: step('st-rv', 'Revue visuelle'), from: DEV, to: step('ph-conception', 'Conception') },
  { kind: 'tool.attached', step: MAQUETTES, tool: { kind: 'mcp', name: 'stitch' } },
  { kind: 'tool.detached', step: MAQUETTES, tool: { kind: 'mcp', name: 'stitch' } },
  { kind: 'arrow.added', from: REVIEW_END, to: MERGE },
  { kind: 'arrow.removed', from: REVIEW_END, to: MERGE },
  { kind: 'loop-back.added', from: REVIEW, to: CODE, max: 3 },
  { kind: 'loop-back.removed', from: REVIEW, to: CODE, max: 3 },
  { kind: 'loop-back.max-changed', from: REVIEW, to: CODE, before: 3, after: 5 },
  { kind: 'layout.changed' },
];

describe('changeLabel', () => {
  it('names every kind of change in French', () => {
    expect(ONE_OF_EACH.map((change) => change.kind)).toEqual([...PROCESS_CHANGE_KINDS]);
    expect(ONE_OF_EACH.map((change) => changeLabel(change))).toEqual([
      'Phase « Livraison » ajoutée',
      'Phase « Qualité » retirée',
      'Phase « Développement » renommée « Réalisation »',
      'Phase « Développement » : une fois, au lieu de pour chaque Ticket prêt',
      'Étape « Inventaire » ajoutée à « Conception »',
      'Étape « Revue visuelle » retirée de « Développement »',
      'Étape « Revue visuelle » déplacée de « Développement » vers « Conception »',
      'Serveur MCP « stitch » attaché à « Maquettes »',
      'Serveur MCP « stitch » retiré de « Maquettes »',
      'flèche « Review » → « Merge » ajoutée',
      'flèche « Review » → « Merge » retirée',
      'Retour de « Review » vers « Code » ajouté : 3 fois au plus',
      'Retour de « Review » vers « Code » retiré',
      'Retour de « Review » vers « Code » : 5 fois au plus, au lieu de 3',
      'disposition du canevas modifiée',
    ]);
  });

  it('names each kind of Outil, a Rôle by its name', () => {
    const attached = (tool: Tool) => changeLabel({ kind: 'tool.attached', step: MAQUETTES, tool }, { 'role-ux': 'Designer' });
    expect(attached({ kind: 'role', roleId: 'design' })).toBe('Rôle « Conception » attaché à « Maquettes »');
    expect(attached({ kind: 'role', roleId: 'role-ux' })).toBe('Rôle « Designer » attaché à « Maquettes »');
    expect(attached({ kind: 'skill', skillId: 'visual-design' })).toBe('Skill « visual-design » attaché à « Maquettes »');
    expect(attached({ kind: 'command', commandId: 'e2e' })).toBe('Commande attachée à « Maquettes »');
    expect(attached({ kind: 'connector', connector: 'github' })).toBe('Connecteur GitHub attaché à « Maquettes »');
  });
});

describe('changeLabels', () => {
  it('labels the diff of two definitions, in its order', () => {
    const draft: ProcessDefinition = structuredClone(PROCESS_CREWDECK);
    draft.steps.find((candidate) => candidate.id === 'st-maquettes')!.tools.push({ kind: 'mcp', name: 'Stitch' }, { kind: 'mcp', name: 'Figma' });
    draft.loopBacks.find((loopBack) => loopBack.from === 'st-review')!.max = 5;

    expect(changeLabels(diffDefinitions(PROCESS_CREWDECK, draft))).toEqual([
      'Serveur MCP « Stitch » attaché à « Maquettes »',
      'Serveur MCP « Figma » attaché à « Maquettes »',
      'Retour de « Review » vers « Code » : 5 fois au plus, au lieu de 3',
    ]);
  });
});
