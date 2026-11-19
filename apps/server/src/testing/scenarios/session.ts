import { randomBytes } from 'node:crypto';
import type { EngineEvent } from '@crewdeck/contracts';
import { publicKeyFor } from '../vault.js';
import { PROJECTS, seedDecisions } from './a-toi.js';
import { defineScenario, type ScenarioContext, type ScenarioSeed } from './define.js';
import { seedTrustedDevice } from './idees.js';
import { seedRepositories } from './projets.js';
import { LAST_SEEN_AT, RUNNER_MACHINE } from './runner.js';

/** The Session of the mockups, « Concevoir · Agenda partagé » of Personal OS: one id, for the scenarios' path. */
export const SESSION_ID = '019a6f1e-7c3d-7e4f-9a1b-5e5510000001';

/** Where the mockups' Session panel opens: over « À toi », whose Décision « Concevoir · Agenda partagé » leads to it. */
export const SESSION_PATH = `/a-toi?session=${SESSION_ID}`;

/** When the Pilote stopped it in `session-arretee`: 15:12 in Paris. */
export const STOPPED_AT = new Date('2026-11-11T14:12:00.000Z');

const SECOND = 1000;

/**
 * The Session's log as the Runner keeps it, from `design/screens/crewdeck/session.html`:
 * its reads, its message (streamed, then whole), its search, its list of what
 * is missing, its last read, the last event 42 s before `now`. The Pilote's
 * « Pense aux événements récurrents » is not in it: the Runner logs no input.
 */
export const sessionLog = (now: number): EngineEvent[] => {
  const at = (secondsAgo: number) => new Date(now - secondsAgo * SECOND).toISOString();
  const intro = 'L’Idée demande un agenda que plusieurs personnes partagent. Le PRD de Personal OS a déjà un agenda personnel : je regarde ce qu’il couvre avant de te poser mes questions.';
  return [
    { kind: 'tool-call', seq: 1, at: at(300), callId: 'read-prd', tool: 'Read', target: 'docs/product/prd.md' },
    { kind: 'tool-result', seq: 2, at: at(299), callId: 'read-prd', ok: true, detail: '281 lignes' },
    { kind: 'tool-call', seq: 3, at: at(290), callId: 'read-context', tool: 'Read', target: 'CONTEXT.md' },
    { kind: 'tool-result', seq: 4, at: at(289), callId: 'read-context', ok: true, detail: '223 lignes' },
    { kind: 'message', seq: 5, at: at(280), from: 'agent', text: 'L’Idée demande un agenda que plusieurs personnes partagent. ', final: false },
    { kind: 'message', seq: 6, at: at(278), from: 'agent', text: intro, final: true },
    { kind: 'tool-call', seq: 7, at: at(240), callId: 'grep-agenda', tool: 'Grep', target: 'agenda · apps/web/src' },
    { kind: 'tool-result', seq: 8, at: at(239), callId: 'grep-agenda', ok: true, detail: '14 fichiers' },
    {
      kind: 'message',
      seq: 9,
      at: at(120),
      from: 'agent',
      text: 'Noté. L’agenda actuel a déjà les événements récurrents ; il manque :\n\n- qui voit un agenda partagé ;\n- qui peut modifier ses événements ;\n- ce que voit un membre qui quitte l’agenda.\n\nJe prépare les questions.',
      final: true,
    },
    { kind: 'tool-call', seq: 10, at: at(43), callId: 'read-agenda', tool: 'Read', target: 'docs/product/features/agenda.md' },
    { kind: 'tool-result', seq: 11, at: at(42), callId: 'read-agenda', ok: true, detail: '96 lignes' },
  ];
};

type SessionState = 'starting' | 'stopped' | 'interrupted';

/**
 * The Pilote of « À toi » (its nine Décisions), Personal OS followed, both
 * Comptes IA connected (the Cadre's Runner card names them), a trusted
 * Appareil paired with the Runner, and the Session in `state`, its log held
 * by the fake Runner for that Appareil; `online`, the Runner connects (and
 * starts a `starting` Session, `active` then), else it is offline since 14:02.
 */
const seedSession = async (ctx: ScenarioContext, state: SessionState, online: boolean): Promise<ScenarioSeed> => {
  const { token, ...seed } = await seedDecisions(ctx, online ? undefined : LAST_SEEN_AT);
  const { pilotId } = seed;
  await seedRepositories(ctx, pilotId, [{ name: 'personal-os', hasCode: true, project: PROJECTS.personalOs.projectName, projectId: PROJECTS.personalOs.projectId }]);
  const { device } = await seedTrustedDevice(ctx, pilotId);
  const runnerPrivateKey = randomBytes(32);
  const runnerPublicKey = publicKeyFor(runnerPrivateKey);
  const now = Date.now();
  await ctx.prisma.unscoped.agentSession.create({
    data: {
      id: SESSION_ID,
      pilotId,
      projectId: PROJECTS.personalOs.projectId,
      role: 'design',
      engine: 'claude_code',
      model: 'claude-opus-5-5',
      title: 'Concevoir · Agenda partagé',
      branch: 'design/agenda-partage',
      base: 'develop',
      permissionMode: 'auto',
      state,
      interruptedReason: state === 'interrupted' ? 'runner_offline' : null,
      engineSessionId: state === 'starting' ? null : 'fake-agenda-partage',
      startedAt: state === 'stopped' ? new Date(STOPPED_AT.getTime() - 10 * 60 * SECOND) : new Date(now - 5 * 60 * SECOND),
      endedAt: state === 'stopped' ? STOPPED_AT : null,
    },
  });
  ctx.fakes.runner.holdSession(SESSION_ID, { runnerPrivateKey, holders: [Buffer.from(device.publicKey, 'base64url')], events: sessionLog(now) });
  return { ...seed, device: { ...device, runnerPublicKey: runnerPublicKey.toString('base64url') }, ...(online ? { runnerToken: token, runnerMachine: RUNNER_MACHINE } : {}) };
};

/** « Session d’agent » (`design/screens.json`: `session`): the Session of Personal OS running, its conversation relayed from the Runner. */
export const session = defineScenario({ name: 'session', path: SESSION_PATH, seed: (ctx) => seedSession(ctx, 'starting', true) });

/** The Session stopped by the Pilote at 15:12 (`session`, state `arretee`): the stop Banner, « Reprendre », the Composer that resumes. */
export const sessionArretee = defineScenario({ name: 'session-arretee', path: SESSION_PATH, seed: (ctx) => seedSession(ctx, 'stopped', true) });

/** The Runner offline since 14:02 (`session`, state `runner-hors-ligne`): the Session interrupted, only its title and state. */
export const sessionRunnerHorsLigne = defineScenario({
  name: 'session-runner-hors-ligne',
  path: SESSION_PATH,
  seed: (ctx) => seedSession(ctx, 'interrupted', false),
});
