import { PROCESS_CREWDECK, type StepRun } from '@crewdeck/contracts';
import type { PinoLogger } from 'nestjs-pino';
import type { DecisionsService, RaiseInput } from '../../decisions/decisions.service.js';
import type { Tx } from '../../realtime/transactions.js';
import type { Engine } from './engine.js';
import { PhaseItemHandlers } from './items.js';
import { StepRunHooks } from './kinds/step-run-hooks.js';
import { StepDecisions } from './step-decisions.js';

const PROJECT_ID = '019a8f3c-2b4d-7e10-8a5b-6c7d8e9f0a3d';
const PHASE_RUN_ID = '019a8f3c-2b4d-7e10-8a5b-6c7d8e9f0a4e';
const STEP_RUN_ID = '019a8f3c-2b4d-7e10-8a5b-6c7d8e9f0a1b';
const EARLIER_ID = '019a8f3c-2b4d-7e10-8a5b-6c7d8e9f0a0a';

const stepRunOf = (overrides: Partial<StepRun> = {}): StepRun => ({
  id: STEP_RUN_ID,
  projectId: PROJECT_ID,
  phaseRunId: PHASE_RUN_ID,
  stepId: 'st-code',
  kind: 'code',
  iteration: 1,
  state: 'running',
  inputs: [],
  outputs: [],
  verdict: null,
  failure: null,
  reason: null,
  sessionId: null,
  contratVerdict: null,
  canAskChanges: false,
  startedAt: '2026-11-19T10:00:00.000Z',
  endedAt: null,
  ...overrides,
});

const VERDICT = { contractId: 'code', version: 2, status: 'incomplete' as const, failedRuleIds: ['code.tests', 'code.lint'], warningRuleIds: [], headSha: 'b'.repeat(40) };

const setup = (options: { projectId?: string | null; openEarlier?: { kind: string; subjectId: string }[] } = {}) => {
  const projectId = options.projectId === undefined ? PROJECT_ID : options.projectId;
  const tx = {
    phaseRun: {
      findUniqueOrThrow: vi.fn(() =>
        Promise.resolve({ id: PHASE_RUN_ID, projectId, processVersionId: null, builtinTemplate: 'process-crewdeck', phaseId: 'ph-dev', itemType: 'ticket', itemId: '57' }),
      ),
    },
    project: { findUnique: vi.fn(() => Promise.resolve({ displayName: 'Site mairie' })) },
    stepRun: { findMany: vi.fn(() => Promise.resolve([{ id: EARLIER_ID }])) },
    decision: { findMany: vi.fn(() => Promise.resolve(options.openEarlier ?? [])) },
  } as unknown as Tx;
  const raised: RaiseInput[] = [];
  const resolved: unknown[][] = [];
  const decisions = {
    raise: vi.fn((_tx: Tx, input: RaiseInput) => {
      raised.push(input);
      return Promise.resolve({ decision: {}, created: true });
    }),
    resolve: vi.fn((_tx: Tx, ...args: unknown[]) => {
      resolved.push(args);
      return Promise.resolve(undefined);
    }),
  } as unknown as DecisionsService;
  const engine = { definitionFor: () => Promise.resolve(PROCESS_CREWDECK) } as unknown as Engine;
  const items = new PhaseItemHandlers();
  const logger = { error: vi.fn() };
  const hooks = new StepRunHooks();
  const service = new StepDecisions(hooks, decisions, engine, items, logger as unknown as PinoLogger);
  service.onModuleInit();
  return { tx, hooks, items, raised, resolved, logger };
};

describe('the Décisions of an agent Étape’s StepRun (ATOI-2)', () => {
  it('raises « Contrat incomplet » on an incomplete verdict: the Étape and Phase named by the pinned definition, the failed rules’ ids and their count', async () => {
    const { tx, hooks, raised } = setup();

    await hooks.finished(tx, stepRunOf(), { status: 'incomplete', verdict: VERDICT, failure: 'contract-incomplete' });

    expect(raised).toEqual([
      {
        kind: 'contract-incomplete',
        projectId: PROJECT_ID,
        projectName: 'Site mairie',
        subjectType: 'step-run',
        subjectId: STEP_RUN_ID,
        label: 'Code',
        metaParts: ['Développement'],
        tone: 'caution',
        link: `/projets/${PROJECT_ID}`,
        params: {
          stepRunId: STEP_RUN_ID,
          phaseRunId: PHASE_RUN_ID,
          stepId: 'st-code',
          itemType: 'ticket',
          itemId: '57',
          itemLabelled: false,
          contractId: 'code',
          contractVersion: 2,
          failedRuleIds: 'code.tests,code.lint',
          failedCount: 2,
        },
      },
    ]);
  });

  it('adds the item’s readable label and page when its module gives them, none when it cannot read it (a Local Ticket); without a Projet, the link is « À toi »', async () => {
    const labelled = setup();
    labelled.items.add({ itemType: 'ticket', label: (_tx, id) => Promise.resolve(`#${id} Recherche d’actes`), link: (_tx, id) => Promise.resolve(`/boucle?ticket=${id}`), onStopped: () => Promise.resolve() });
    await labelled.hooks.finished(labelled.tx, stepRunOf(), { status: 'incomplete', verdict: VERDICT });
    expect(labelled.raised[0]).toMatchObject({ label: 'Code · #57 Recherche d’actes', link: '/boucle?ticket=57', params: { itemLabelled: true } });

    // A Local Ticket: its module registered, its title sealed, no label; the page adds the title it opens.
    const local = setup();
    local.items.add({ itemType: 'ticket', label: () => Promise.resolve(null), link: (_tx, id) => Promise.resolve(`/boucle?ticket=${id}`), onStopped: () => Promise.resolve() });
    await local.hooks.finished(local.tx, stepRunOf(), { status: 'incomplete', verdict: VERDICT });
    expect(local.raised[0]).toMatchObject({ label: 'Code', link: '/boucle?ticket=57', params: { itemType: 'ticket', itemId: '57', itemLabelled: false } });
    // « Maximum de Retours atteint » names it as without a handler.
    expect(await local.items.label(local.tx, { itemType: 'ticket', itemId: '57' }, 'Développement')).toBe('Développement · Ticket');

    const unpinned = setup({ projectId: null });
    await unpinned.hooks.finished(unpinned.tx, stepRunOf({ projectId: null }), { status: 'failed', failure: 'session-error' });
    expect(unpinned.raised[0]).toMatchObject({ projectId: null, projectName: null, link: '/a-toi' });
  });

  it('raises « Étape échouée » on a Session ended in error or stopped by the Runner, with its failure', async () => {
    const { tx, hooks, raised } = setup();

    await hooks.finished(tx, stepRunOf(), { status: 'failed', failure: 'session-error' });
    await hooks.finished(tx, stepRunOf({ id: EARLIER_ID }), { status: 'failed', failure: 'session-stopped' });

    expect(raised.map(({ kind, subjectId, label, params }) => ({ kind, subjectId, label, failure: params['failure'] }))).toEqual([
      { kind: 'step-failed', subjectId: STEP_RUN_ID, label: 'Code', failure: 'session-error' },
      { kind: 'step-failed', subjectId: EARLIER_ID, label: 'Code', failure: 'session-stopped' },
    ]);
  });

  it('raises nothing for any other failure (no-handler, contract-unchecked), logged with its code', async () => {
    const { tx, hooks, raised, logger } = setup();

    await hooks.finished(tx, stepRunOf(), { status: 'failed', failure: 'no-handler' });
    await hooks.finished(tx, stepRunOf(), { status: 'failed', failure: 'contract-unchecked' });

    expect(raised).toEqual([]);
    expect(logger.error.mock.calls.map(([fields]) => (fields as { failure: string }).failure)).toEqual(['no-handler', 'contract-unchecked']);
  });

  it('resolves, passed, the open Décisions of the earlier StepRuns of the Étape in the PhaseRun once one passes; raises nothing', async () => {
    const { tx, hooks, raised, resolved } = setup({ openEarlier: [{ kind: 'contract-incomplete', subjectId: EARLIER_ID }] });

    await hooks.finished(tx, stepRunOf(), { status: 'passed' });

    expect(resolved).toEqual([['contract-incomplete', EARLIER_ID, 'passed']]);
    expect(raised).toEqual([]);
  });
});
