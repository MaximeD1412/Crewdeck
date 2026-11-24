import { zDecision } from '@crewdeck/contracts';
import type { StepRunContext } from '../../process/engine/kinds/handler.js';
import type { Tx } from '../../realtime/transactions.js';
import { INVENTORY_BRANCH, INVENTORY_KIND, inventoryHeadOf } from './inventory.kind.js';
import { inventoryReviewDecision } from './inventory.service.js';

const PROJECT = '019a6f00-0000-7000-8000-000000000011';
const SHA = 'c'.repeat(40);

const run = (headSha?: string, projectId: string | null = PROJECT): StepRunContext =>
  ({
    phaseRun: { projectId },
    stepRun: { contratVerdict: headSha === undefined ? null : { contractId: 'inventory', version: 1, status: 'passed', failedRuleIds: [], warningRuleIds: [], headSha } },
  }) as unknown as StepRunContext;

const tx = (releaseBranch: string): Tx => ({ project: { findUniqueOrThrow: () => Promise.resolve({ releaseBranch }) } }) as unknown as Tx;

describe('the Étape « Inventaire »', () => {
  it('titles its Session « Inventaire », on crewdeck/inventaire from the Projet’s release branch', async () => {
    expect(INVENTORY_KIND.kind).toBe('inventory');
    expect(INVENTORY_KIND.title(tx('trunk'), run())).toBe('Inventaire');
    expect(INVENTORY_KIND.branch(tx('trunk'), run())).toBe(INVENTORY_BRANCH);
    expect(INVENTORY_BRANCH).toBe('crewdeck/inventaire');
    expect(await INVENTORY_KIND.base?.(tx('trunk'), run())).toBe('trunk');
  });

  it('gives the Projet’s Inventaire at the head its verdict names, none when it names no commit', async () => {
    expect(await INVENTORY_KIND.outputs(tx('trunk'), run(SHA))).toEqual([{ portId: 'inventaire', type: 'inventory', id: PROJECT, sha: SHA }]);
    expect(await INVENTORY_KIND.outputs(tx('trunk'), run())).toEqual([{ portId: 'inventaire', type: 'inventory', id: PROJECT }]);
    expect(inventoryHeadOf('HEAD')).toBeNull();
    expect(inventoryHeadOf(undefined)).toBeNull();
    await expect(async () => INVENTORY_KIND.outputs(tx('trunk'), run(SHA, null))).rejects.toThrow(/Projet/);
  });
});

describe('inventoryReviewDecision', () => {
  it('is « Inventaire à approuver » of the Projet: its name when readable, « Inventaire » for a Local one, its page', () => {
    const github = inventoryReviewDecision(PROJECT, 'courtside');
    expect(github).toEqual({
      kind: 'inventory-review',
      projectId: PROJECT,
      projectName: 'courtside',
      subjectType: 'project',
      subjectId: PROJECT,
      label: 'courtside',
      metaParts: ['Projet existant'],
      tone: 'accent',
      link: `/projets/${PROJECT}`,
      params: {},
    });
    expect(inventoryReviewDecision(PROJECT, null)).toMatchObject({ projectName: null, label: 'Inventaire' });
    const at = '2026-11-24T08:00:00.000Z';
    expect(zDecision.safeParse({ ...github, id: PROJECT, state: 'open', outcome: null, createdAt: at, resolvedAt: null }).success).toBe(true);
  });
});
