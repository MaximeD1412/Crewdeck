import { zDecision } from '@crewdeck/contracts';
import { blockedDecision, mergeSubject } from './local-merges.js';

describe('« Merge en attente » of a local change of code', () => {
  const projectId = '019a6f00-0000-7000-8000-0000000000b1';

  it('is one Décision per change, caution, its Projet as its link, no action', () => {
    const input = blockedDecision(projectId, 3);
    expect(input).toEqual({
      kind: 'merge.local-blocked',
      projectId,
      projectName: null,
      subjectType: 'code-change',
      subjectId: `${projectId}:3`,
      label: 'Merge en attente : tes modifications touchent les mêmes fichiers',
      metaParts: ['Changement #3'],
      tone: 'caution',
      link: `/projets/${projectId}`,
      params: {},
    });
    expect(mergeSubject(projectId, 3)).toBe(input.subjectId);
    const decision = { ...input, id: '019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6c12', state: 'open', outcome: null, createdAt: '2026-11-20T09:00:00.000Z', resolvedAt: null };
    expect(zDecision.safeParse(decision).success).toBe(true);
  });
});
