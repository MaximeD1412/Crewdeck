import type { Decision } from '@crewdeck/contracts';
import { COMPOSANTS } from '@crewdeck/sdk';
import { aToiView } from '../a-toi.js';
import { inventoryReviewView } from './inventory-review.js';
import { decisionViews } from './registry.js';

const NOW = new Date('2026-11-24T10:25:00.000Z');
const PROJECT_ID = '019a6f00-0000-7000-8000-0000000000c1';

const review: Decision = {
  id: '019a6f1e-7c3d-7e4f-9a1b-2c3d4e5f6c31',
  kind: 'inventory-review',
  projectId: PROJECT_ID,
  projectName: 'courtside',
  subjectType: 'project',
  subjectId: PROJECT_ID,
  label: 'courtside',
  metaParts: ['Projet existant'],
  tone: 'accent',
  link: `/projets/${PROJECT_ID}`,
  params: {},
  state: 'open',
  outcome: null,
  createdAt: '2026-11-24T10:00:00.000Z',
  resolvedAt: null,
};

describe('« Inventaire à approuver » in « À toi »', () => {
  it('says what was drafted from the code, to approve before the Process, and « Relire » opens the Projet', async () => {
    expect(decisionViews.viewOf('inventory-review')).toBe(inventoryReviewView);
    const data = aToiView([review], {}, { runnerOnline: true, now: NOW, projectName: () => 'courtside', localText: () => '' });
    expect(COMPOSANTS.PageAToi.data.parse(data)).toEqual(data);
    expect(data.decisions[0]).toMatchObject({
      kind: 'Inventaire à approuver',
      title: 'courtside',
      context: 'Glossaire, choix techniques et inventaire rédigés depuis le code : à approuver avant le Process.',
      tone: 'accent',
      actions: [{ id: 'read', label: 'Relire', primary: true, disabledReason: null }],
    });

    const visited: string[] = [];
    const [read] = inventoryReviewView.actions;
    await read?.run(review, { navigate: (url) => visited.push(url), client: { command: () => Promise.reject(new Error('no command')) } });
    expect(visited).toEqual([`/projets/${PROJECT_ID}`]);
  });
});
