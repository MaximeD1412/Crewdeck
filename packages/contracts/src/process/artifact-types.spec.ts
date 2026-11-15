import { ARTIFACT_TYPE_LABELS, ARTIFACT_TYPES, zArtifactType } from './artifact-types.js';

describe('Types d’artefact', () => {
  it('are the nine of ADR 0011, each with its French label', () => {
    expect(ARTIFACT_TYPES).toEqual(['idea', 'prd', 'mockups', 'technical-design', 'inventory', 'ticket', 'code-change', 'verdict', 'delivery']);
    expect(ARTIFACT_TYPE_LABELS).toEqual({
      idea: 'Idée',
      prd: 'PRD',
      mockups: 'Maquettes',
      'technical-design': 'Conception technique',
      inventory: 'Inventaire',
      ticket: 'Ticket',
      'code-change': 'Changement de code',
      verdict: 'Verdict',
      delivery: 'Livraison',
    });
  });

  it('refuses a type outside the list', () => {
    expect(zArtifactType.safeParse('code-change').success).toBe(true);
    expect(zArtifactType.safeParse('commit').success).toBe(false);
  });
});
