import { contratRegistry, type Decision, defineContrat } from '@crewdeck/contracts';
import { COMPOSANTS } from '@crewdeck/sdk';
import type { z } from 'zod';
import type { Client } from '../../api/client.js';
import { aToiView, type AToiOptions } from '../a-toi.js';
import { contractIncompleteView, createContractIncompleteView } from './contract-incomplete.js';
import { decisionViews, type DecisionReads } from './registry.js';

const NOW = new Date('2026-11-20T10:25:00.000Z');
const PROJECT_ID = '019a6f1e-7c3d-7e4f-9a1b-2c3d4e5f6a03';
const STEP_RUN_ID = '019a6f1e-7c3d-7e4f-9a1b-2c3d4e5f6e01';

/** The Contrat « code » as its ticket will declare it, its first version and the current one. */
const REGISTRY = contratRegistry(
  [
    defineContrat({
      id: 'code',
      version: 2,
      step: 'code',
      rules: [
        { id: 'code.tests', label: 'Les tests passent', severity: 'bloquant', kind: 'file', path: 'TESTS.md' },
        { id: 'code.lint', label: 'Le lint passe', severity: 'bloquant', kind: 'file', path: 'LINT.md' },
      ],
    }),
  ],
  [defineContrat({ id: 'code', version: 1, step: 'code', rules: [{ id: 'code.tests', label: 'Des tests existent', severity: 'bloquant', kind: 'file', path: 'TESTS.md' }] })],
);
const view = createContractIncompleteView(REGISTRY);

const incomplete = (params: Partial<Decision['params']> = {}, overrides: Partial<Decision> = {}): Decision => ({
  id: '019a6f1e-7c3d-7e4f-9a1b-2c3d4e5f6c01',
  kind: 'contract-incomplete',
  projectId: PROJECT_ID,
  projectName: 'Site mairie',
  subjectType: 'step-run',
  subjectId: STEP_RUN_ID,
  label: 'Code du front',
  metaParts: ['Développement'],
  tone: 'caution',
  link: `/projets/${PROJECT_ID}`,
  params: {
    stepRunId: STEP_RUN_ID,
    phaseRunId: '019a6f1e-7c3d-7e4f-9a1b-2c3d4e5f6b01',
    stepId: 'st-code',
    itemType: 'ticket',
    itemId: '57',
    itemLabelled: false,
    contractId: 'code',
    contractVersion: 2,
    failedRuleIds: 'code.tests,code.lint',
    failedCount: 2,
    ...params,
  } as Decision['params'],
  state: 'open',
  outcome: null,
  createdAt: '2026-11-20T10:00:00.000Z',
  resolvedAt: null,
  ...overrides,
});

const row = (decision: Decision, options: Partial<AToiOptions> = {}) => {
  const data = aToiView([decision], {}, { runnerOnline: true, now: NOW, views: { viewOf: () => view, register: () => undefined }, ...options });
  expect(COMPOSANTS.PageAToi.data.parse(data)).toEqual(data);
  return data.decisions[0];
};

const READS: DecisionReads = { runnerOnline: true, sessionEvent: () => ({ state: 'reading' }), roleName: (role) => role, localText: () => '…', ticketTitle: () => null };

const recording = () => {
  const calls: unknown[] = [];
  const client = {
    command: (async (method: string, path: string, body: object, schema?: z.ZodType) => {
      calls.push({ method, path, body });
      return schema?.parse({ stepRun: null });
    }) as Client['command'],
  };
  return { calls, client };
};

describe('the « Contrat incomplet » Décision in « À toi »', () => {
  it('is registered: the Étape’s name as title, the Phase in its meta, the first failed rule’s label and the count of the others, « Relancer l’Étape » then « Voir »', () => {
    expect(decisionViews.viewOf('contract-incomplete')).toBe(contractIncompleteView);
    expect(row(incomplete())).toEqual({
      id: incomplete().id,
      kind: 'Contrat incomplet',
      title: 'Code du front',
      meta: 'Site mairie · Développement · il y a 25 min',
      context: 'Les tests passent et 1 autre',
      tone: 'caution',
      icon: 'contract',
      actions: [
        { id: 'rerun', label: 'Relancer l’Étape', primary: true, disabledReason: null },
        { id: 'open', label: 'Voir', primary: false, disabledReason: null },
      ],
    });
  });

  it('reads each label from the version the verdict was checked against; counts the others; names a rule no declaration has', () => {
    expect(view.context?.(incomplete({ failedRuleIds: 'code.tests', failedCount: 1, contractVersion: 1 }), READS)).toBe('Des tests existent');
    expect(view.context?.(incomplete({ failedRuleIds: 'code.lint,code.tests,code.pr', failedCount: 3 }), READS)).toBe('Le lint passe et 2 autres');
    expect(view.context?.(incomplete({ failedRuleIds: 'report.schema', failedCount: 1 }), READS)).toBe('Le rapport de l’Étape ne suit pas son format');
    expect(view.context?.(incomplete({ failedRuleIds: 'report.missing', failedCount: 1 }), READS)).toBe('L’Étape n’a pas rendu son rapport');
    expect(view.context?.(incomplete({ failedRuleIds: 'code.pr', failedCount: 1 }), READS)).toBe('Règle « code.pr »');
    expect(view.context?.(incomplete({ failedRuleIds: '', failedCount: 0 }), READS)).toBeNull();
  });

  it('adds the Ticket’s title the page holds when the server could not read it (a Local Ticket’s, opened), never over a readable label', () => {
    const ticketTitle = vi.fn((projectId: string, number: number) => (projectId === PROJECT_ID && number === 57 ? 'Recherche d’actes' : null));
    expect(row(incomplete(), { ticketTitle })?.title).toBe('Code du front · #57 Recherche d’actes');
    expect(row(incomplete({ itemId: '58' }), { ticketTitle })?.title).toBe('Code du front');
    expect(row(incomplete({ itemLabelled: true }, { label: 'Code · #57 Recherche d’actes' }), { ticketTitle })?.title).toBe('Code · #57 Recherche d’actes');
    expect(row(incomplete({ itemType: 'prd', itemId: 'agenda' }), { ticketTitle })?.title).toBe('Code du front');
  });

  it('« Relancer l’Étape » needs no Runner: offered while it is offline, the Session waiting for it', () => {
    expect(row(incomplete(), { runnerOnline: false })?.actions[0]).toEqual({ id: 'rerun', label: 'Relancer l’Étape', primary: true, disabledReason: null });
  });

  it('« Relancer l’Étape » posts the StepRun’s rerun; « Voir » opens the Décision’s link', async () => {
    const { calls, client } = recording();
    const navigate = vi.fn();
    const decision = incomplete();
    for (const id of ['rerun', 'open']) await view.actions.find((action) => action.id === id)?.run(decision, { navigate, client });

    expect(calls).toEqual([{ method: 'POST', path: `/api/step-runs/${STEP_RUN_ID}/rerun`, body: {} }]);
    expect(navigate).toHaveBeenCalledWith(`/projets/${PROJECT_ID}`);
  });
});
