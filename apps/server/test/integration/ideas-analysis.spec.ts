import { randomBytes } from 'node:crypto';
import { type Event, type Idea, ideaItemAad, PROCESS_CREWDECK, PROCESS_CREWDECK_NAME, type ProcessDefinition, zIdea, zState } from '@crewdeck/contracts';
import type { INestApplication } from '@nestjs/common';
import pg from 'pg';
import { inject } from 'vitest';
import { SESSION_COOKIE } from '../../src/auth/cookies.js';
import { WebSessions } from '../../src/auth/web-sessions.js';
import { appOrigin, parseEnv } from '../../src/config/env.js';
import { Prisma } from '../../src/generated/prisma/client.js';
import { newId } from '../../src/ids.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { EventsBus } from '../../src/realtime/events.bus.js';
import { RunnerWaitingWork } from '../../src/runners/waiting-work.js';
import { runInPilotScope } from '../../src/scope/scope.context.js';
import { createLinkedRunner } from '../../src/testing/runners.js';
import { TEST_WEBHOOK_SECRET } from '../fakes/github.js';
import { connectRunner, type FakeRunnerClient } from '../fakes/runner.js';
import { authKeysEnv } from '../github-app.js';
import { expectEnvelope, expectFields, startApp } from '../route-baseline.js';

const databaseUrl = inject('databaseUrl');
const env = parseEnv({
  CREWDECK_ENV: 'test',
  DATABASE_URL: databaseUrl,
  CREWDECK_FAKES: '1',
  PUBLIC_URL: 'https://crewdeck.example',
  GITHUB_WEBHOOK_SECRET: TEST_WEBHOOK_SECRET,
  ...authKeysEnv(),
});
const ORIGIN = appOrigin(env);

const sql = async <T extends pg.QueryResultRow>(text: string, values: unknown[] = []): Promise<T[]> => {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    return (await client.query<T>(text, values)).rows;
  } finally {
    await client.end();
  }
};

interface Tab {
  id: string;
  cookie: string;
}

/** A text as the page or the Runner seals it: opaque to the server (random bytes here). */
const sealed = (bytes = 64) => ({ key: randomBytes(60).toString('base64url'), ciphertext: randomBytes(bytes).toString('base64url') });

const verdict = (status: 'passed' | 'incomplete', failedRuleIds: string[] = []) => ({ contractId: 'idea-analysis', version: 1, status, failedRuleIds, warningRuleIds: [] });

/** « Process Crewdeck » whose « Idée » Phase repeats for nothing: no Idée enters it. */
const WITHOUT_IDEA_NOTED: ProcessDefinition = {
  ...PROCESS_CREWDECK,
  phases: PROCESS_CREWDECK.phases.map((phase) => (phase.forEach === 'idea.noted' ? { ...phase, forEach: null } : phase)),
};

interface StepRunRow {
  id: string;
  step_id: string;
  state: string;
  failure: string | null;
  session_id: string | null;
  outputs: unknown;
  reason: string | null;
}

describe('the analysis of an Idée against PostgreSQL', () => {
  let app: INestApplication;
  let url: string;
  let prisma: PrismaService;
  const logs: string[] = [];
  const published: Event[] = [];
  const unsubscribes: (() => void)[] = [];
  const sockets: FakeRunnerClient[] = [];

  beforeAll(async () => {
    ({ app, url } = await startApp(env, { logs: { write: (line: string) => logs.push(line) } }));
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    for (const socket of sockets.splice(0)) socket.close();
    await empty();
    await app.close();
  });

  /** A Runner's socket closed by the last test may still be interrupting its Sessions: a deadlock is retried. */
  const empty = async (): Promise<void> => {
    for (let attempt = 1; ; attempt += 1) {
      try {
        await sql('TRUNCATE pilots CASCADE');
        return;
      } catch (error) {
        if ((error as { code?: string }).code !== '40P01' || attempt >= 5) throw error;
      }
    }
  };

  beforeEach(async () => {
    for (const socket of sockets.splice(0)) socket.close();
    await empty();
    logs.length = 0;
  });

  afterEach(() => {
    for (const unsubscribe of unsubscribes.splice(0)) unsubscribe();
    published.length = 0;
  });

  /** A Pilote whose vault is at version 1, its Rôle Idée on Claude Code unless `engine` is false. */
  const pilot = async ({ engine = true }: { engine?: boolean } = {}): Promise<Tab> => {
    const id = newId();
    await sql(
      `WITH p AS (INSERT INTO pilots (id, display_name, time_zone, vault_key_version) VALUES ($1, 'octocat', 'Europe/Paris', 1) RETURNING id) INSERT INTO pilot_identities (id, pilot_id, provider, subject, login) SELECT gen_random_uuid(), id, 'github', $2::text, 'octocat' FROM p`,
      [id, Math.floor(Math.random() * 1e9)],
    );
    if (engine) {
      await sql('INSERT INTO account_settings (pilot_id, roles, updated_at) VALUES ($1, $2, now())', [id, JSON.stringify({ idea: { engine: 'claude-code', model: 'claude-sonnet-5-5' } })]);
    }
    const token = await runInPilotScope(id, () => app.get(WebSessions).open(prisma.scoped, id, undefined));
    unsubscribes.push(app.get(EventsBus).subscribe(id, (event) => published.push(event)));
    return { id, cookie: `${SESSION_COOKIE}=${token}` };
  };

  /** A Projet of `tab` with its repository, its Sources, and its version 1 of `definition`. */
  const project = async (tab: Tab, name: string, definition: ProcessDefinition = PROCESS_CREWDECK): Promise<string> => {
    const repositoryId = newId();
    const id = newId();
    const githubId = Math.floor(Math.random() * 1e9);
    await sql(
      `INSERT INTO repositories (id, pilot_id, installation_id, github_id, owner, name, full_name, private, default_branch, has_code, updated_at)
       VALUES ($1, $2, 61000001, $3, 'octocat', $4, $5, true, 'main', true, now())`,
      [repositoryId, tab.id, githubId, name, `octocat/${name}`],
    );
    await sql(
      `INSERT INTO projects (id, pilot_id, repository_id, github_repo_id, owner, name, full_name, display_name, release_branch, integration_branch, has_code, inventory_state, last_seq)
       VALUES ($1, $2, $3, $4, 'octocat', $5, $6, $5, 'main', 'develop', true, 'not-needed', 0)`,
      [id, tab.id, repositoryId, githubId, name, `octocat/${name}`],
    );
    await prisma.unscoped.artifactSource.createMany({
      data: (['ticket', 'code'] as const).map((group) => ({ id: newId(), pilotId: tab.id, projectId: id, group, source: 'github' as const, since: new Date() })),
    });
    await prisma.unscoped.processVersion.create({
      data: {
        id: newId(),
        pilotId: tab.id,
        projectId: id,
        number: 1,
        definition: definition as unknown as Prisma.InputJsonValue,
        sealed: Prisma.DbNull,
        activatedAt: new Date(),
        activatedBy: 'creation',
        templateName: PROCESS_CREWDECK_NAME,
      },
    });
    return id;
  };

  /** An Idée already open, noted before: what the context lists beside the analysed one. */
  const openIdea = async (tab: Tab, number: number, state = 'to-triage'): Promise<{ id: string; text: { key: string; ciphertext: string } }> => {
    const id = newId();
    const text = sealed();
    await sql(
      `INSERT INTO ideas (id, pilot_id, number, state, text, noted_from, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, 'pc', now() - interval '1 hour', now() - interval '1 hour')`,
      [id, tab.id, number, state, JSON.stringify(text)],
    );
    await sql('UPDATE pilots SET idea_seq = GREATEST(idea_seq, $2) WHERE id = $1', [tab.id, number]);
    return { id, text };
  };

  const call = (tab: Tab | undefined, path: string, body?: unknown): Promise<Response> =>
    fetch(`${url}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { ...(tab ? { cookie: tab.cookie } : {}), origin: ORIGIN, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

  const state = async (tab: Tab) => zState.parse(await (await call(tab, '/api/state')).json());
  const seq = async (tab: Tab) => String((await state(tab)).seq);

  const note = async (tab: Tab, projectId: string | null = null): Promise<Idea> => {
    const res = await call(tab, '/api/ideas', { id: newId(), text: sealed(), vaultKeyVersion: 1, projectId, notedFrom: 'pc', dictated: false, seq: await seq(tab) });
    expect(res.status).toBe(201);
    return zIdea.parse(await res.json());
  };

  const online = async (tab: Tab): Promise<FakeRunnerClient> => {
    const { token } = await createLinkedRunner(prisma, tab.id);
    const socket = await connectRunner(url, token);
    sockets.push(socket);
    socket.hello({});
    await socket.expect('hello.accepted');
    return socket;
  };

  const idea = async (tab: Tab, id: string): Promise<Idea> => {
    const found = (await state(tab)).ideas.find((candidate) => candidate.id === id);
    if (!found) throw new Error(`No Idée ${id}`);
    return found;
  };

  const phaseRuns = (ideaId: string) =>
    sql<{ id: string; project_id: string | null; process_version_id: string | null; builtin_template: string | null; phase_id: string; state: string }>(
      `SELECT id, project_id, process_version_id, builtin_template, phase_id, state FROM phase_runs WHERE item_type = 'idea' AND item_id = $1 ORDER BY started_at`,
      [ideaId],
    );
  const analyses = (ideaId: string) =>
    sql<StepRunRow>(
      `SELECT s.id, s.step_id, s.state, s.failure, s.session_id, s.outputs, s.reason FROM step_runs s JOIN phase_runs p ON p.id = s.phase_run_id
       WHERE p.item_type = 'idea' AND p.item_id = $1 AND s.kind = 'idea-analysis' ORDER BY s.started_at, s.id`,
      [ideaId],
    );

  /** The Runner reports the analysis of the Session `start` with `figures`, its Contrat `passed`, then the Session ends. */
  const report = (socket: FakeRunnerClient, start: { sessionId: string; step?: { stepRunId: string } }, figures: Record<string, unknown>, content = sealed(200)) => {
    const stepRunId = start.step?.stepRunId ?? '';
    socket.send({ type: 'step.started', stepRunId });
    socket.send({ type: 'session.state', sessionId: start.sessionId, state: 'active' });
    socket.send({ type: 'step.report', stepRunId, figures, sealed: content });
    socket.send({ type: 'step.verdict', stepRunId, verdict: verdict('passed') });
    socket.send({ type: 'session.state', sessionId: start.sessionId, state: 'ended', outcome: 'ok' });
    return content;
  };

  /** The Runner's Contrat refuses the report (a summary of 401 characters): incomplete, then the Session ends. */
  const refuse = (socket: FakeRunnerClient, start: { sessionId: string; step?: { stepRunId: string } }) => {
    const stepRunId = start.step?.stepRunId ?? '';
    socket.send({ type: 'step.started', stepRunId });
    socket.send({ type: 'step.verdict', stepRunId, verdict: verdict('incomplete', ['idea-analysis.report.schema']) });
    socket.send({ type: 'session.state', sessionId: start.sessionId, state: 'ended', outcome: 'ok' });
  };

  describe('admission', () => {
    it('analyses an Idée of a Projet: its PhaseRun on the version, its scratch Session with the Idées, then analysed with its figures and its sealed sentences', async () => {
      const tab = await pilot();
      const projectId = await project(tab, 'factures');
      const earlier = await openIdea(tab, 1);
      const socket = await online(tab);

      const noted = await note(tab, projectId);

      expect(noted).toMatchObject({ number: 2, state: 'analysing', analysis: null, analysisRun: { status: 'running', role: 'idea', engine: 'claude-code', failedRuleIds: [] } });
      const [run] = await phaseRuns(noted.id);
      expect(run).toMatchObject({ project_id: projectId, builtin_template: null, phase_id: 'ph-idee', state: 'running' });
      expect(run?.process_version_id).not.toBeNull();
      const [analysis] = await analyses(noted.id);
      expect(analysis).toMatchObject({ step_id: 'st-analyse', state: 'running' });
      expect(noted.analysisRun?.stepRunId).toBe(analysis?.id);

      const start = await socket.expect('session.start');
      expect(start).toMatchObject({
        sessionId: analysis?.session_id,
        projectId,
        origin: null,
        branch: null,
        base: null,
        worktreeCommands: null,
        role: 'idea',
        engine: 'claude-code',
        model: 'claude-sonnet-5-5',
        title: null,
        step: {
          stepRunId: analysis?.id,
          stepKind: 'idea-analysis',
          skill: 'idea-analysis',
          contractId: 'idea-analysis',
          ideas: { idea: { id: noted.id, number: 2, text: noted.text, analysis: null }, open: [{ id: earlier.id, number: 1, text: earlier.text, analysis: null }] },
        },
      });

      // Titled by the Idée's text, sealed as the page sealed it.
      const [titled] = await sql<{ title: string | null; title_sealed: unknown; title_aad: string | null }>('SELECT title, title_sealed, title_aad FROM agent_sessions WHERE id = $1', [start.sessionId]);
      expect(titled).toEqual({ title: null, title_sealed: noted.text, title_aad: ideaItemAad(noted.id, 'text') });

      const content = report(socket, start, { impact: 4, effort: 2, projectId, duplicateIds: [earlier.id] });

      await vi.waitFor(async () => expect((await idea(tab, noted.id)).state).toBe('analysed'));
      const analysed = await idea(tab, noted.id);
      expect(analysed).toMatchObject({
        analysis: content,
        impact: 4,
        effort: 2,
        targetProjectId: projectId,
        targetIsNew: false,
        duplicateIds: [earlier.id],
        analysisRun: { stepRunId: analysis?.id, status: 'passed', role: 'idea', engine: 'claude-code', contractId: 'idea-analysis', contractVersion: 1, failedRuleIds: [] },
      });
      expect(analysed.analysedAt).not.toBeNull();
      expect((await analyses(noted.id))[0]).toMatchObject({ state: 'done', outputs: [{ portId: 'idee', type: 'idea', id: noted.id }] });
      expect(published.filter((event) => event.type === 'idea.upserted').map((event) => (event.payload as Idea).state)).toEqual(['analysing', 'analysed']);

      // The figures readable, the sentences as the Runner sealed them; nothing of them in the logs but ids.
      const [row] = await sql<{ analysis: unknown; analysis_pending: unknown }>('SELECT analysis, analysis_pending FROM ideas WHERE id = $1', [noted.id]);
      expect(row).toEqual({ analysis: content, analysis_pending: null });
      const all = logs.join('\n');
      expect(all).not.toContain(content.ciphertext);
      expect(all).not.toContain(content.key);
      const reported = logs.map((line) => JSON.parse(line) as Record<string, unknown>).find((line) => line.msg === 'idea analysis reported');
      expect(reported).toMatchObject({ stepRunId: analysis?.id, ideaId: noted.id });
      expect(Object.keys(reported ?? {})).not.toContain('figures');
    });

    it('analyses an Idée without a Projet on « Process Crewdeck » with the account’s Rôle Idée, « nouveau » making it a new Projet', async () => {
      const tab = await pilot();
      const socket = await online(tab);

      const noted = await note(tab, null);

      expect(noted.state).toBe('analysing');
      expect(await phaseRuns(noted.id)).toEqual([expect.objectContaining({ project_id: null, process_version_id: null, builtin_template: 'process-crewdeck', phase_id: 'ph-idee' })]);
      const start = await socket.expect('session.start');
      expect(start).toMatchObject({ projectId: null, origin: null, branch: null, role: 'idea', engine: 'claude-code', step: { stepKind: 'idea-analysis', ideas: { open: [] } } });
      const [session] = await sql<{ project_id: string | null; branch: string | null; base: string | null }>('SELECT project_id, branch, base FROM agent_sessions WHERE id = $1', [start.sessionId]);
      expect(session).toEqual({ project_id: null, branch: null, base: null });

      report(socket, start, { impact: 3, effort: 3, projectId: 'nouveau', duplicateIds: [] });

      await vi.waitFor(async () => expect((await idea(tab, noted.id)).state).toBe('analysed'));
      expect(await idea(tab, noted.id)).toMatchObject({ targetProjectId: null, targetIsNew: true, impact: 3, effort: 3 });
    });

    it('admits nothing for a Projet whose active version has no idea.noted Phase: to triage, no PhaseRun, no Session', async () => {
      const tab = await pilot();
      const projectId = await project(tab, 'factures', WITHOUT_IDEA_NOTED);

      const noted = await note(tab, projectId);

      expect(noted).toMatchObject({ state: 'to-triage', analysisRun: null });
      expect(await phaseRuns(noted.id)).toEqual([]);
      expect(await sql('SELECT id FROM agent_sessions WHERE pilot_id = $1', [tab.id])).toEqual([]);
    });

    it('admits nothing while the Rôle Idée has no Moteur: the Idée is noted to triage, no PhaseRun', async () => {
      const tab = await pilot({ engine: false });

      const noted = await note(tab, null);

      expect(noted).toMatchObject({ state: 'to-triage', analysisRun: null });
      expect(await phaseRuns(noted.id)).toEqual([]);
    });

    it('waits for the Runner: listed as « Idées » by idea-analysis, not by step-runs, then started at its hello', async () => {
      const tab = await pilot();
      const projectId = await project(tab, 'factures');

      const withoutProject = await note(tab, null);
      await note(tab, projectId);

      expect(withoutProject.state).toBe('analysing');
      const waiting = await runInPilotScope(tab.id, () => app.get(RunnerWaitingWork).collect(tab.id));
      expect(waiting).toEqual([
        { projectId, name: 'factures', items: [{ kind: 'ideas-waiting', count: 1 }] },
        { projectId: null, name: 'Idées', items: [{ kind: 'ideas-waiting', count: 1 }] },
      ]);

      const socket = await online(tab);
      const starts = [await socket.expect('session.start'), await socket.expect('session.start')];
      expect(starts.map((start) => start.step?.stepKind)).toEqual(['idea-analysis', 'idea-analysis']);
    });
  });

  describe('a failed analysis', () => {
    it('leaves the Idée to triage on an incomplete Contrat, raises « Contrat incomplet », and « Relancer l’analyse » starts a new StepRun', async () => {
      const tab = await pilot();
      const socket = await online(tab);
      const noted = await note(tab, null);
      const start = await socket.expect('session.start');

      refuse(socket, start);

      await vi.waitFor(async () => expect((await idea(tab, noted.id)).state).toBe('to-triage'));
      expect((await idea(tab, noted.id)).analysisRun).toMatchObject({ status: 'incomplete', contractId: 'idea-analysis', contractVersion: 1, failedRuleIds: ['idea-analysis.report.schema'] });
      const [first] = await analyses(noted.id);
      expect(first).toMatchObject({ state: 'failed', failure: 'contract-incomplete' });
      expect(await sql(`SELECT state FROM decisions WHERE kind = 'contract-incomplete' AND subject_id = $1`, [first?.id])).toEqual([{ state: 'open' }]);

      const res = await call(tab, `/api/ideas/${noted.id}/reanalyse`, { seq: await seq(tab) });

      expect(res.status).toBe(200);
      expect(zIdea.parse(await res.json())).toMatchObject({ state: 'analysing', analysisRun: { status: 'running' } });
      const runs = await analyses(noted.id);
      expect(runs.map((run) => run.state)).toEqual(['failed', 'running']);
      expect(await sql(`SELECT state, outcome FROM decisions WHERE kind = 'contract-incomplete' AND subject_id = $1`, [first?.id])).toEqual([{ state: 'resolved', outcome: 'rerun' }]);
      expect((await socket.expect('session.start')).step?.stepRunId).toBe(runs[1]?.id);
    });

    it('runs a passed analysis again, keeping it until the new one passes', async () => {
      const tab = await pilot();
      const socket = await online(tab);
      const noted = await note(tab, null);
      const content = report(socket, await socket.expect('session.start'), { impact: 2, effort: 5, projectId: 'nouveau', duplicateIds: [] });
      await vi.waitFor(async () => expect((await idea(tab, noted.id)).state).toBe('analysed'));

      const res = await call(tab, `/api/ideas/${noted.id}/reanalyse`, { seq: await seq(tab) });

      expect(res.status).toBe(200);
      expect(zIdea.parse(await res.json())).toMatchObject({ state: 'analysing', analysis: content, impact: 2, effort: 5 });
      const again = await socket.expect('session.start');
      expect(again.step?.ideas?.idea.analysis).toEqual(content);
      refuse(socket, again);
      await vi.waitFor(async () => expect((await idea(tab, noted.id)).state).toBe('to-triage'));
      expect(await idea(tab, noted.id)).toMatchObject({ analysis: content, impact: 2, effort: 5, analysisRun: { status: 'incomplete' } });
    });
  });

  describe('POST /api/ideas/:id/target', () => {
    it('sets another Projet visé, then « nouveau », without running the analysis again; the PhaseRun keeps its version', async () => {
      const tab = await pilot();
      const projectId = await project(tab, 'factures');
      const other = await project(tab, 'agenda');
      const socket = await online(tab);
      const noted = await note(tab, projectId);
      report(socket, await socket.expect('session.start'), { impact: 4, effort: 2, projectId, duplicateIds: [] });
      await vi.waitFor(async () => expect((await idea(tab, noted.id)).state).toBe('analysed'));
      const [before] = await phaseRuns(noted.id);

      const moved = await call(tab, `/api/ideas/${noted.id}/target`, { projectId: other, seq: await seq(tab) });

      expect(moved.status).toBe(200);
      expect(zIdea.parse(await moved.json())).toMatchObject({ state: 'analysed', targetProjectId: other, targetIsNew: false, impact: 4 });
      const fresh = await call(tab, `/api/ideas/${noted.id}/target`, { projectId: null, seq: await seq(tab) });
      expect(zIdea.parse(await fresh.json())).toMatchObject({ targetProjectId: null, targetIsNew: true });
      expect(await analyses(noted.id)).toHaveLength(1);
      expect(await phaseRuns(noted.id)).toEqual([before]);
      expect(published.filter((event) => event.type === 'idea.upserted').at(-1)?.payload).toMatchObject({ id: noted.id, targetIsNew: true });
    });
  });

  describe('route baseline of target and reanalyse', () => {
    const ROUTES = ['target', 'reanalyse'] as const;
    const bodyOf = (route: (typeof ROUTES)[number], seqValue: string) => (route === 'target' ? { projectId: null, seq: seqValue } : { seq: seqValue });

    it('refuses an invalid body (400), no session (401), another Pilote’s Idée (404), a stale seq (409)', async () => {
      const tab = await pilot({ engine: false });
      const stranger = await pilot({ engine: false });
      const noted = await note(tab, null);
      const theirs = await note(stranger, null);
      for (const route of ROUTES) {
        await expectFields(await call(tab, `/api/ideas/${noted.id}/${route}`, bodyOf(route, 'x')), ['seq']);
        await expectEnvelope(await call(undefined, `/api/ideas/${noted.id}/${route}`, bodyOf(route, '0')), 401, 'auth.required');
        await expectEnvelope(await call(tab, `/api/ideas/${theirs.id}/${route}`, bodyOf(route, await seq(tab))), 404, 'idea.not-found');
        await expectEnvelope(await call(tab, `/api/ideas/not-an-id/${route}`, bodyOf(route, await seq(tab))), 404, 'idea.not-found');
      }
      // Its own event is after seq 0: stale.
      await expectEnvelope(await call(tab, `/api/ideas/${noted.id}/target`, bodyOf('target', '0')), 409, 'realtime.stale');
      await sql(`UPDATE ideas SET analysis_run = $2 WHERE id = $1`, [noted.id, JSON.stringify({ stepRunId: newId(), status: 'incomplete', role: 'idea', engine: null, at: new Date().toISOString(), contractId: null, contractVersion: null, failedRuleIds: [] })]);
      await expectEnvelope(await call(tab, `/api/ideas/${noted.id}/reanalyse`, bodyOf('reanalyse', '0')), 409, 'realtime.stale');
    });

    it('refuses a Projet visé of another Pilote (404)', async () => {
      const tab = await pilot({ engine: false });
      const stranger = await pilot({ engine: false });
      const theirProject = await project(stranger, 'secret');
      const noted = await note(tab, null);
      await expectEnvelope(await call(tab, `/api/ideas/${noted.id}/target`, { projectId: theirProject, seq: await seq(tab) }), 404, 'project.not-found');
    });

    it('refuses an Idée merged or rejected (422 ideas.not-triageable), a running analysis (422 ideas.analysis-running), an Idée without analysis Étape (422 ideas.no-analysis-step)', async () => {
      const tab = await pilot();
      await online(tab);
      const running = await note(tab, null);
      await expectEnvelope(await call(tab, `/api/ideas/${running.id}/reanalyse`, { seq: await seq(tab) }), 422, 'ideas.analysis-running');

      const merged = await openIdea(tab, 10, 'merged');
      for (const route of ROUTES) await expectEnvelope(await call(tab, `/api/ideas/${merged.id}/${route}`, bodyOf(route, await seq(tab))), 422, 'ideas.not-triageable');
      const rejected = await openIdea(tab, 11, 'rejected');
      await expectEnvelope(await call(tab, `/api/ideas/${rejected.id}/reanalyse`, { seq: await seq(tab) }), 422, 'ideas.not-triageable');

      const unanalysed = await openIdea(tab, 12);
      await expectEnvelope(await call(tab, `/api/ideas/${unanalysed.id}/reanalyse`, { seq: await seq(tab) }), 422, 'ideas.no-analysis-step');
    });
  });
});
