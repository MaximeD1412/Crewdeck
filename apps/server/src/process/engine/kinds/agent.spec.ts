import {
  type AgentSession,
  type ArtifactRef,
  type PhaseRun,
  PROCESS_CREWDECK,
  type Step,
  type StepRun,
  type Tool,
  type Verdict,
} from '@crewdeck/contracts';
import type { PinoLogger } from 'nestjs-pino';
import { z } from 'zod';
import { AppError } from '../../../errors/app-error.js';
import type { PrismaService } from '../../../prisma/prisma.service.js';
import type { Transactions, Tx } from '../../../realtime/transactions.js';
import { RunnerDispatcher } from '../../../runners/runner-dispatcher.js';
import type { RunnerOffline } from '../../../runners/runner-offline.service.js';
import type { RunnerPresence } from '../../../runners/runner-presence.service.js';
import type { RunnerWaitingWork, WaitingWorkProvider } from '../../../runners/waiting-work.js';
import { runInPilotScope } from '../../../scope/scope.context.js';
import { SessionHooks } from '../../../sessions/session-hooks.js';
import type { SessionsService, StartSession } from '../../../sessions/sessions.service.js';
import type { SettingsService } from '../../../settings/settings.service.js';
import type { Engine } from '../engine.js';
import { AgentSteps, type AgentKindSpec, type AgentSignal, mcpServersOf, REPORT_MISSING_RULE, REPORT_SCHEMA_RULE, sessionInputsOf } from './agent.js';
import type { StepKindHandler, StepResult, StepRunContext } from './handler.js';
import { type StepRunFinished, StepRunHooks } from './step-run-hooks.js';

const TX = {} as Tx;
const STEP_RUN_ID = '019a8f3c-2b4d-7e10-8a5b-6c7d8e9f0a1b';
const SESSION_ID = '019a8f3c-2b4d-7e10-8a5b-6c7d8e9f0a2c';
const PROJECT_ID = '019a8f3c-2b4d-7e10-8a5b-6c7d8e9f0a3d';
const PILOT_ID = '019a8f3c-2b4d-7e10-8a5b-6c7d8e9f0a7b';
/** In the Pilote's scope, as the engine runs a handler. */
const asPilot = <T>(fn: () => Promise<T>): Promise<T> => runInPilotScope(PILOT_ID, fn);
const CHANGE: ArtifactRef = { portId: 'changement', type: 'code-change', id: '57', sha: 'a'.repeat(40) };
const SHA = 'b'.repeat(40);

const CODE = PROCESS_CREWDECK.steps.find((step) => step.id === 'st-code') as Step;
const ANALYSE = PROCESS_CREWDECK.steps.find((step) => step.id === 'st-analyse') as Step;
const IDEA_ID = '019a8f3c-2b4d-7e10-8a5b-6c7d8e9f0b01';
const SEALED = { key: 'k'.repeat(80), ciphertext: 'c'.repeat(120) };
const SEALED_TITLE = { ...SEALED, aad: `${IDEA_ID}:text` };
/** « Code » with a Rôle of the Pilote's, another Skill, two Serveurs MCP and an Entrée « maquettes » nothing fed. */
const TOOLED: Step = {
  ...CODE,
  inputs: [...CODE.inputs, { id: 'maquettes', type: 'mockups' }, { id: 'conception', type: 'technical-design' }],
  tools: [
    { kind: 'role', roleId: 'r-a1b2c3d4' },
    { kind: 'skill', skillId: 'crewdeck-test' },
    { kind: 'mcp', name: 'stitch' },
    { kind: 'command', commandId: 'dev' },
    { kind: 'mcp', name: 'figma' },
  ] satisfies Tool[],
};

const stepRunOf = (overrides: Partial<StepRun> = {}): StepRun => ({
  id: STEP_RUN_ID,
  projectId: PROJECT_ID,
  phaseRunId: '019a8f3c-2b4d-7e10-8a5b-6c7d8e9f0a4e',
  stepId: 'st-code',
  kind: 'code',
  iteration: 1,
  state: 'running',
  inputs: [{ portId: 'ticket', artifacts: [{ portId: 'ticket', type: 'ticket', id: '12' }], absent: false }],
  outputs: [],
  verdict: null,
  failure: null,
  reason: null,
  sessionId: SESSION_ID,
  contratVerdict: null,
  canAskChanges: false,
  startedAt: '2026-11-19T10:00:00.000Z',
  endedAt: null,
  ...overrides,
});

const runOf = (stepRun: Partial<StepRun> = {}, step: Step = CODE): StepRunContext => ({
  phaseRun: { id: stepRun.phaseRunId ?? '019a8f3c-2b4d-7e10-8a5b-6c7d8e9f0a4e', projectId: PROJECT_ID } as PhaseRun,
  stepRun: stepRunOf(stepRun),
  step,
  definition: PROCESS_CREWDECK,
});

const sessionOf = (overrides: Partial<AgentSession> = {}): AgentSession => ({
  id: SESSION_ID,
  projectId: PROJECT_ID,
  role: 'code',
  engine: 'claude-code',
  model: 'claude-opus-5-5',
  title: 'Le panier garde ses articles',
  titleSealed: null,
  state: 'active',
  interruptedReason: null,
  outcome: null,
  error: null,
  stepRunId: STEP_RUN_ID,
  branch: 'feat/12-panier',
  startedAt: '2026-11-19T10:00:00.000Z',
  endedAt: null,
  ...overrides,
});

const verdictOf = (status: Verdict['status'], failedRuleIds: string[] = []): Verdict => ({ contractId: 'code', version: 2, status, failedRuleIds, warningRuleIds: [], headSha: SHA });

const SPEC: AgentKindSpec = { kind: 'code', contractId: 'code', title: () => 'Le panier garde ses articles', branch: () => 'feat/12-panier', outputs: () => [CHANGE] };

const setup = (options: { roles?: Record<string, { engine: 'claude-code' | 'codex'; model: string } | null> } = {}) => {
  const engine = {
    signal: vi.fn<(tx: Tx, id: string, signal: unknown) => Promise<boolean>>(() => Promise.resolve(true)),
    recordSession: vi.fn(() => Promise.resolve()),
    recordContratVerdict: vi.fn((_tx: Tx, run: StepRunContext, verdict: Verdict) => Promise.resolve({ ...run.stepRun, contratVerdict: verdict })),
  };
  const sessionHooks = new SessionHooks();
  const sessions = {
    start: vi.fn<(tx: Tx, input: StartSession) => Promise<AgentSession>>(() => Promise.resolve(sessionOf({ state: 'starting' }))),
    stopIn: vi.fn(async (tx: Tx, id: string) => {
      await sessionHooks.changed(tx, sessionOf({ id, state: 'stopped' }));
    }),
  };
  const settings = {
    effective: vi.fn(() =>
      Promise.resolve({ roles: options.roles ?? { code: { engine: 'claude-code', model: 'claude-opus-5-5' }, 'r-a1b2c3d4': { engine: 'codex', model: 'gpt-5.5' } } }),
    ),
  };
  const hooks = new StepRunHooks();
  const finished: { stepRun: StepRun; finished: StepRunFinished }[] = [];
  hooks.onFinished((_tx, stepRun, outcome) => {
    finished.push({ stepRun, finished: outcome });
    return Promise.resolve();
  });
  const providers: WaitingWorkProvider[] = [];
  const work = {
    register: (provider: WaitingWorkProvider) => {
      providers.push(provider);
      return () => undefined;
    },
  };
  const waiting = [
    { projectId: PROJECT_ID, project: { displayName: 'Crewdeck', name: 'crewdeck' } },
    { projectId: PROJECT_ID, project: { displayName: 'Crewdeck', name: 'crewdeck' } },
    { projectId: '019a8f3c-2b4d-7e10-8a5b-6c7d8e9f0a5f', project: { displayName: null, name: null } },
  ];
  const prisma = { scoped: { agentSession: { findMany: vi.fn(() => Promise.resolve(waiting)) } } };
  const logger = { warn: vi.fn(), error: vi.fn() };
  const dispatcher = new RunnerDispatcher();
  const steps = new AgentSteps(
    engine as unknown as Engine,
    sessions as unknown as SessionsService,
    sessionHooks,
    settings as unknown as SettingsService,
    hooks,
    { run: <T>(fn: (tx: Tx) => Promise<T>) => fn(TX) } as unknown as Transactions,
    dispatcher,
    { isOnline: () => true } as unknown as RunnerPresence,
    { refresh: vi.fn(() => Promise.resolve()) } as unknown as RunnerOffline,
    work as unknown as RunnerWaitingWork,
    prisma as unknown as PrismaService,
    logger as unknown as PinoLogger,
  );
  steps.onModuleInit();
  const handler: StepKindHandler = steps.defineAgentKind(SPEC);
  const signal = (run: StepRunContext, value: AgentSignal): Promise<StepResult | null> => handler.onSignal(TX, run, value);
  return { steps, handler, signal, engine, sessions, sessionHooks, settings, finished, providers, prisma, logger, dispatcher };
};

describe('the agent Étapes', () => {
  it('starts the Session of the Étape’s Rôle on the Moteur and model in effect, a skill Outil over the catalogue’s Skill, and writes its id on the StepRun', async () => {
    const { handler, sessions, settings, engine } = setup();
    const run = runOf(
      {
        sessionId: null,
        inputs: [
          { portId: 'ticket', artifacts: [{ portId: 'ticket', type: 'ticket', id: '12' }], absent: false },
          { portId: 'maquettes', artifacts: [], absent: true },
          { portId: 'conception', artifacts: [{ portId: 'document', type: 'technical-design', id: 'docs/conception.md', sha: SHA }], absent: false },
        ],
      },
      TOOLED,
    );

    expect(await asPilot(() => handler.start(TX, run))).toBe('running');

    expect(settings.effective).toHaveBeenCalledWith(PILOT_ID, PROJECT_ID);
    expect(sessions.start).toHaveBeenCalledWith(TX, {
      projectId: PROJECT_ID,
      role: 'r-a1b2c3d4',
      engine: 'codex',
      model: 'gpt-5.5',
      title: 'Le panier garde ses articles',
      branch: 'feat/12-panier',
      step: {
        stepRunId: STEP_RUN_ID,
        stepKind: 'code',
        skill: 'crewdeck-test',
        contractId: 'code',
        inputs: [
          { portId: 'ticket', type: 'ticket', ref: { id: '12', number: 12 } },
          { portId: 'maquettes', type: 'mockups', ref: null },
          { portId: 'conception', type: 'technical-design', ref: { id: 'docs/conception.md', sha: SHA } },
        ],
      },
      mcpServers: ['stitch', 'figma'],
    });
    expect(engine.recordSession).toHaveBeenCalledWith(TX, run, SESSION_ID);
  });

  it('takes the kind’s Rôle and Skill from the catalogue without Outils, and no Serveur MCP', async () => {
    const { handler, sessions } = setup();

    await asPilot(() => handler.start(TX, runOf({ sessionId: null })));

    expect(sessions.start).toHaveBeenCalledWith(TX, expect.objectContaining({ role: 'code', engine: 'claude-code', model: 'claude-opus-5-5', mcpServers: [] }));
    expect(sessions.start.mock.calls[0]?.[1].step).toMatchObject({ skill: 'code', inputs: [{ portId: 'ticket', type: 'ticket', ref: { id: '12', number: 12 } }] });
    expect(mcpServersOf({ step: CODE })).toEqual([]);
  });

  it('refuses to start without a Moteur for the Rôle: 422 step-run.no-engine, no Session', async () => {
    const { handler, sessions } = setup({ roles: { code: null } });

    await expect(asPilot(() => handler.start(TX, runOf({ sessionId: null })))).rejects.toMatchObject({ code: 'step-run.no-engine' } satisfies Partial<AppError>);
    expect(sessions.start).not.toHaveBeenCalled();
  });

  it('fails no-engine a StepRun of a kind the Process starts on its own while its Rôle has no Moteur: no Session, StepRunHooks.onFinished once', async () => {
    const { steps, sessions, finished } = setup({ roles: { code: null } });
    const own = steps.defineAgentKind({ ...SPEC, kind: 'review', withoutEngine: 'fail' });

    expect(await asPilot(() => own.start(TX, runOf({ sessionId: null, kind: 'review' })))).toEqual({ state: 'failed', failure: 'no-engine' });

    expect(sessions.start).not.toHaveBeenCalled();
    expect(finished).toEqual([{ stepRun: expect.objectContaining({ id: STEP_RUN_ID }), finished: { status: 'failed', failure: 'no-engine' } }]);
  });

  it('starts a scratch Session for a kind without a branch: no Projet, the account’s Rôles, its step’s context', async () => {
    const { steps, sessions, settings } = setup({ roles: { idea: { engine: 'claude-code', model: 'claude-sonnet-5-5' } } });
    const ideas = { idea: { id: IDEA_ID, number: 3, text: SEALED, analysis: null }, open: [] };
    const scratch = steps.defineAgentKind({ kind: 'idea-analysis', title: () => SEALED_TITLE, branch: () => null, outputs: () => [], stepContext: () => Promise.resolve({ ideas }), waitingWork: 'own' });
    const run = { ...runOf({ sessionId: null, stepId: 'st-analyse', kind: 'idea-analysis', inputs: [] }, ANALYSE), phaseRun: { id: 'p', projectId: null } as PhaseRun };

    expect(await asPilot(() => scratch.start(TX, run))).toBe('running');

    expect(settings.effective).toHaveBeenCalledWith(PILOT_ID, undefined);
    expect(sessions.start).toHaveBeenCalledWith(TX, expect.objectContaining({ projectId: null, branch: null, role: 'idea', engine: 'claude-code', title: SEALED_TITLE }));
    expect(sessions.start.mock.calls[0]?.[1].step).toMatchObject({ stepKind: 'idea-analysis', skill: 'idea-analysis', contractId: 'idea-analysis', ideas });
  });

  it('refuses to start a Session with a branch for a StepRun of no Projet', async () => {
    const { handler, sessions } = setup();
    const run = { ...runOf({ sessionId: null }), phaseRun: { id: 'p', projectId: null } as PhaseRun };

    await expect(asPilot(() => handler.start(TX, run))).rejects.toThrow(/no Projet/);
    expect(sessions.start).not.toHaveBeenCalled();
  });

  it('gives an Entrée « absente » as null, one entry per Artefact otherwise, a numeric id with its number', () => {
    const run = runOf(
      {
        inputs: [
          { portId: 'ticket', artifacts: [{ portId: 'ticket', type: 'ticket', id: '12' }, { portId: 'ticket', type: 'ticket', id: 'idee-1' }], absent: false },
          { portId: 'maquettes', artifacts: [], absent: true },
        ],
      },
      TOOLED,
    );

    expect(sessionInputsOf(run)).toEqual([
      { portId: 'ticket', type: 'ticket', ref: { id: '12', number: 12 } },
      { portId: 'ticket', type: 'ticket', ref: { id: 'idee-1' } },
      { portId: 'maquettes', type: 'mockups', ref: null },
    ]);
  });

  it('makes the StepRun running as its Skill starts or its Session is active again, interrupted while its Session is stopped or cut', async () => {
    const { signal } = setup();

    expect(await signal(runOf({ state: 'interrupted' }), { kind: 'step.started' })).toEqual({ state: 'running' });
    expect(await signal(runOf(), { kind: 'step.started' })).toBeNull();
    expect(await signal(runOf({ state: 'interrupted' }), { kind: 'session', session: sessionOf({ state: 'active' }) })).toEqual({ state: 'running' });
    expect(await signal(runOf(), { kind: 'session', session: sessionOf({ state: 'stopped' }) })).toEqual({ state: 'interrupted', failure: 'session-stopped' });
    expect(await signal(runOf(), { kind: 'session', session: sessionOf({ state: 'interrupted' }) })).toEqual({ state: 'interrupted', failure: 'session-interrupted' });
    expect(await signal(runOf(), { kind: 'session', session: sessionOf({ state: 'waiting' }) })).toBeNull();
    expect(await signal(runOf(), { kind: 'session', session: sessionOf({ id: '019a8f3c-2b4d-7e10-8a5b-6c7d8e9f0a6a', state: 'stopped' }) })).toBeNull();
  });

  it('writes the Contrat’s verdict on the StepRun, its state unchanged', async () => {
    const { signal, engine } = setup();
    const run = runOf();

    expect(await signal(run, { kind: 'step.verdict', verdict: verdictOf('passed') })).toBeNull();
    expect(engine.recordContratVerdict).toHaveBeenCalledWith(TX, run, verdictOf('passed'));
  });

  it('finishes the StepRun once its Session ended: passed with its outputs, incomplete or failed otherwise, StepRunHooks.onFinished once each', async () => {
    const { signal, finished } = setup();
    const ended = (overrides: Partial<AgentSession> = {}) => ({ kind: 'session', session: sessionOf({ state: 'ended', outcome: 'ok', ...overrides }) }) as const;

    expect(await signal(runOf({ contratVerdict: verdictOf('passed') }), ended())).toEqual({ state: 'done', outputs: [CHANGE] });
    expect(await signal(runOf({ contratVerdict: verdictOf('incomplete', ['code.tests']) }), ended())).toEqual({ state: 'failed', failure: 'contract-incomplete' });
    expect(await signal(runOf({ contratVerdict: verdictOf('passed') }), ended({ outcome: 'error', error: 'engine-failed' }))).toEqual({ state: 'failed', failure: 'session-error' });
    expect(await signal(runOf(), ended())).toEqual({ state: 'failed', failure: 'contract-unchecked' });

    expect(finished.map(({ finished: outcome }) => outcome)).toEqual([
      { status: 'passed', verdict: verdictOf('passed') },
      { status: 'incomplete', verdict: verdictOf('incomplete', ['code.tests']), failure: 'contract-incomplete' },
      { status: 'failed', verdict: verdictOf('passed'), failure: 'session-error' },
      { status: 'failed', failure: 'contract-unchecked' },
    ]);
  });

  it('passes a StepRun whose kind has no Contrat once its Session ended ok', async () => {
    const { steps, finished } = setup();
    const handler = steps.defineAgentKind({ ...SPEC, kind: 'review', contractId: null });

    expect(await handler.onSignal(TX, runOf({ kind: 'review' }), { kind: 'session', session: sessionOf({ state: 'ended', outcome: 'ok' }) })).toEqual({ state: 'done', outputs: [CHANGE] });
    expect(finished).toEqual([{ stepRun: expect.objectContaining({ id: STEP_RUN_ID }), finished: { status: 'passed' } }]);
  });

  it('gives a valid report’s figures and sealed content to its kind’s module; an invalid one writes report.schema, the StepRun failed incomplete only once its Session ended', async () => {
    const { steps, signal, engine, finished } = setup();
    const stored: unknown[] = [];
    steps.registerStepReport(
      'code',
      z.strictObject({ tickets: z.int().min(0) }),
      (_tx, _run, report) => {
        stored.push(report);
        return Promise.resolve();
      },
      () => Promise.resolve(stored.length > 0),
    );
    const sealed = { key: 'k'.repeat(80), ciphertext: 'c'.repeat(24) };
    const report = (figures: Record<string, unknown>) => ({ kind: 'step.report', report: { type: 'step.report', id: STEP_RUN_ID, at: '2026-11-19T10:00:00.000Z', stepRunId: STEP_RUN_ID, figures, sealed } }) as const;

    expect(await signal(runOf(), report({ tickets: 3 }))).toBeNull();
    expect(stored).toEqual([{ figures: { tickets: 3 }, sealed }]);

    const before = verdictOf('incomplete', ['code.tests']);
    expect(await signal(runOf({ contratVerdict: before }), report({ tickets: 'trois' }))).toBeNull();
    const written = { ...before, failedRuleIds: ['code.tests', REPORT_SCHEMA_RULE] };
    expect(engine.recordContratVerdict).toHaveBeenCalledWith(TX, expect.anything(), written);
    expect(finished).toEqual([]);
    expect(stored).toHaveLength(1);

    expect(await signal(runOf({ contratVerdict: written }), { kind: 'session', session: sessionOf({ state: 'ended', outcome: 'ok' }) })).toEqual({ state: 'failed', failure: 'contract-incomplete' });
    expect(finished.map(({ finished: outcome }) => outcome)).toEqual([{ status: 'incomplete', verdict: written, failure: 'contract-incomplete' }]);
  });

  it('fails incomplete, rule report.missing, a StepRun whose Contrat passed but whose kind’s report never came', async () => {
    const { steps, signal, engine, finished } = setup();
    const received = vi.fn(() => Promise.resolve(false));
    steps.registerStepReport('code', z.strictObject({ tickets: z.int() }), () => Promise.resolve(), received);
    const passed = runOf({ contratVerdict: verdictOf('passed') });

    expect(await signal(passed, { kind: 'session', session: sessionOf({ state: 'ended', outcome: 'ok' }) })).toEqual({ state: 'failed', failure: 'contract-incomplete' });

    const missing = verdictOf('incomplete', [REPORT_MISSING_RULE]);
    expect(received).toHaveBeenCalledWith(TX, passed);
    expect(engine.recordContratVerdict).toHaveBeenCalledWith(TX, passed, missing);
    expect(finished.map(({ finished: outcome }) => outcome)).toEqual([{ status: 'incomplete', verdict: missing, failure: 'contract-incomplete' }]);

    received.mockResolvedValue(true);
    expect(await signal(passed, { kind: 'session', session: sessionOf({ state: 'ended', outcome: 'ok' }) })).toEqual({ state: 'done', outputs: [CHANGE] });
  });

  it('keeps report.schema in the Runner’s verdict that follows a refused report, passed or not', async () => {
    const { signal, engine } = setup();
    const refused = runOf({ contratVerdict: verdictOf('incomplete', [REPORT_SCHEMA_RULE]) });

    await signal(refused, { kind: 'step.verdict', verdict: verdictOf('passed') });
    expect(engine.recordContratVerdict).toHaveBeenLastCalledWith(TX, refused, verdictOf('incomplete', [REPORT_SCHEMA_RULE]));
    await signal(refused, { kind: 'step.verdict', verdict: verdictOf('incomplete', ['code.tests']) });
    expect(engine.recordContratVerdict).toHaveBeenLastCalledWith(TX, refused, verdictOf('incomplete', ['code.tests', REPORT_SCHEMA_RULE]));
  });

  it('fails incomplete a StepRun whose kind has no Contrat when its report was refused', async () => {
    const { steps, finished } = setup();
    const handler = steps.defineAgentKind({ ...SPEC, kind: 'review', contractId: null });
    const refused = { contractId: 'review', version: 1, status: 'incomplete', failedRuleIds: [REPORT_SCHEMA_RULE], warningRuleIds: [] } as const satisfies Verdict;

    expect(await handler.onSignal(TX, runOf({ kind: 'review', contratVerdict: refused }), { kind: 'session', session: sessionOf({ state: 'ended', outcome: 'ok' }) })).toEqual({ state: 'failed', failure: 'contract-incomplete' });
    expect(finished.map(({ finished: outcome }) => outcome)).toEqual([{ status: 'incomplete', verdict: refused, failure: 'contract-incomplete' }]);
  });

  it('writes a report.schema verdict of the kind’s Contrat when none was checked yet', async () => {
    const { steps, signal, engine } = setup();
    steps.registerStepReport('code', z.strictObject({ tickets: z.int() }), () => Promise.resolve(), () => Promise.resolve(true));

    await signal(runOf(), { kind: 'step.report', report: { type: 'step.report', id: STEP_RUN_ID, at: '2026-11-19T10:00:00.000Z', stepRunId: STEP_RUN_ID, figures: {} } });

    expect(engine.recordContratVerdict).toHaveBeenCalledWith(TX, expect.anything(), { contractId: 'code', version: 1, status: 'incomplete', failedRuleIds: [REPORT_SCHEMA_RULE], warningRuleIds: [] });
  });

  it('ignores a report of a kind without a schema, and one register per kind', async () => {
    const { steps, signal, logger } = setup();

    expect(await signal(runOf(), { kind: 'step.report', report: { type: 'step.report', id: STEP_RUN_ID, at: '2026-11-19T10:00:00.000Z', stepRunId: STEP_RUN_ID, figures: {} } })).toBeNull();
    expect(logger.warn).toHaveBeenCalled();
    steps.registerStepReport('code', z.object({}), () => Promise.resolve(), () => Promise.resolve(true));
    expect(() => steps.registerStepReport('code', z.object({}), () => Promise.resolve(), () => Promise.resolve(true))).toThrow(/code/);
  });

  it('ignores the Skill’s messages before its Session is written, and any signal not its own', async () => {
    const { signal, handler } = setup();

    expect(await signal(runOf({ sessionId: null, state: 'interrupted' }), { kind: 'step.started' })).toBeNull();
    expect(await handler.onSignal(TX, runOf(), { state: 'done', outputs: [] })).toBeNull();
  });

  it('refuses a kind that is not an agent’s', () => {
    const { steps } = setup();

    expect(() => steps.defineAgentKind({ ...SPEC, kind: 'merge' as never })).toThrow(/merge/);
  });

  it('gives the engine its Session’s changes and end, not its start, its waits, nor the stop it made itself', async () => {
    const { handler, engine, sessionHooks, sessions } = setup();

    await sessionHooks.changed(TX, sessionOf({ state: 'starting' }));
    await sessionHooks.changed(TX, sessionOf({ state: 'waiting' }));
    await sessionHooks.changed(TX, sessionOf({ stepRunId: null }));
    await sessionHooks.changed(TX, sessionOf({ state: 'ended', outcome: 'ok' }));
    expect(engine.signal).not.toHaveBeenCalled();

    await sessionHooks.changed(TX, sessionOf({ state: 'active' }));
    await sessionHooks.ended(TX, sessionOf({ state: 'ended', outcome: 'ok' }));
    expect(engine.signal.mock.calls.map(([, id, value]) => [id, (value as { session: AgentSession }).session.state])).toEqual([
      [STEP_RUN_ID, 'active'],
      [STEP_RUN_ID, 'ended'],
    ]);

    await handler.stop?.(TX, runOf());
    expect(sessions.stopIn).toHaveBeenCalledWith(TX, SESSION_ID);
    expect(engine.signal).toHaveBeenCalledTimes(2);
  });

  it('gives the Runner’s step.started, step.report and step.verdict to the engine in a transaction, a failure logged without closing the socket', async () => {
    const { dispatcher, engine, logger } = setup();
    const context = { pilotId: PROJECT_ID, runnerId: SESSION_ID, reply: () => undefined };
    const envelope = { id: SESSION_ID, at: '2026-11-19T10:00:00.000Z' };

    await dispatcher.dispatch({ ...envelope, type: 'step.started', stepRunId: STEP_RUN_ID }, context);
    await dispatcher.dispatch({ ...envelope, type: 'step.verdict', stepRunId: STEP_RUN_ID, verdict: verdictOf('passed') }, context);
    engine.signal.mockRejectedValueOnce(new Error('boom'));
    await dispatcher.dispatch({ ...envelope, type: 'step.report', stepRunId: STEP_RUN_ID, figures: {} }, context);

    expect(engine.signal.mock.calls.map(([tx, id, value]) => [tx, id, (value as AgentSignal).kind])).toEqual([
      [TX, STEP_RUN_ID, 'step.started'],
      [TX, STEP_RUN_ID, 'step.verdict'],
      [TX, STEP_RUN_ID, 'step.report'],
    ]);
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it('lists, as step-runs, the Projets whose agent StepRuns’ Sessions wait to start, their count each', async () => {
    const { providers, prisma } = setup();
    const provider = providers.find((candidate) => candidate.key === 'step-runs');

    expect(await provider?.projectsWaiting(PROJECT_ID)).toEqual([
      { projectId: PROJECT_ID, name: 'Crewdeck', items: [{ kind: 'step-queued', count: 2 }] },
      { projectId: '019a8f3c-2b4d-7e10-8a5b-6c7d8e9f0a5f', name: 'Projet local', items: [{ kind: 'step-queued', count: 1 }] },
    ]);
    expect(prisma.scoped.agentSession.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { state: 'starting', stepRunId: { not: null } } }));
  });

  it('leaves out of step-runs the kinds that list their own waiting work', async () => {
    const { steps, providers, prisma } = setup();
    steps.defineAgentKind({ kind: 'idea-analysis', title: () => SEALED_TITLE, branch: () => null, outputs: () => [], waitingWork: 'own' });

    await providers.find((candidate) => candidate.key === 'step-runs')?.projectsWaiting(PROJECT_ID);

    expect(prisma.scoped.agentSession.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { state: 'starting', stepRunId: { not: null }, stepKind: { notIn: ['idea-analysis'] } } }),
    );
  });
});
