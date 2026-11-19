import { randomBytes } from 'node:crypto';
import type { EngineEvent } from '@crewdeck/contracts';
import { publicKeyFor } from '../vault.js';
import { AGENDA_QUESTION, AGENDA_SESSION_ID, PROJECTS, seedDecisions } from './a-toi.js';
import { defineScenario, type ScenarioContext, type ScenarioSeed } from './define.js';
import { seedTrustedDevice } from './idees.js';
import { seedRepositories } from './projets.js';
import { LAST_SEEN_AT, RUNNER_MACHINE } from './runner.js';

/** The Session of the mockups, « Concevoir · Agenda partagé » of Personal OS: one id, for the scenarios' path. */
export const SESSION_ID = AGENDA_SESSION_ID;

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

/** The request of `session-question`, its `seq` in its log: the first of the agent's three questions. */
export const QUESTION_REQUEST = AGENDA_QUESTION;

/** The request of `session-permission`, its `seq` in its log: a `git push`. */
export const PERMISSION_REQUEST = { requestId: 'toolu_01PushAgenda0000000001', seq: 6 } as const;

/**
 * The log of `session-question`, `packages/contracts/fixtures/runner/sessions/question.jsonl`
 * (its spec checks they are the same) from `design/screens/crewdeck/session-question.html`:
 * a search, a message, then the question waiting, 5 s before `now`.
 */
export const questionLog = (now: number): EngineEvent[] => {
  const at = (secondsAgo: number) => new Date(now - secondsAgo * SECOND).toISOString();
  return [
    { kind: 'tool-call', seq: 1, at: at(55), callId: 'toolu_01GrepAgenda0000000001', tool: 'Grep', target: 'agenda · apps/web/src' },
    { kind: 'tool-result', seq: 2, at: at(54), callId: 'toolu_01GrepAgenda0000000001', ok: true, detail: '14 fichiers' },
    { kind: 'message', seq: 3, at: at(5), from: 'agent', text: 'L’agenda actuel a déjà les événements récurrents. Il manque trois règles ; voici la première.', final: true },
    {
      kind: 'question',
      seq: QUESTION_REQUEST.seq,
      at: at(0),
      requestId: QUESTION_REQUEST.requestId,
      title: 'Qui peut modifier un événement d’un agenda partagé ?',
      options: [
        { label: 'Tous les membres de l’agenda', detail: 'Reco : la règle la plus simple, et l’agenda reste à jour quel que soit l’auteur.' },
        { label: 'Seulement son auteur', detail: 'Les autres membres le voient en lecture seule.' },
        { label: 'Au choix, pour chaque agenda', detail: 'Chaque agenda dit qui peut modifier ses événements.' },
      ],
      multiple: false,
      index: 1,
      count: 3,
    },
  ];
};

/**
 * The log of `session-permission`, `packages/contracts/fixtures/runner/sessions/permission.jsonl`
 * (its spec checks they are the same) from `design/screens/crewdeck/session-permission.html`:
 * the PRD written and committed, then the `git push` waiting for the Pilote.
 */
export const permissionLog = (now: number): EngineEvent[] => {
  const at = (secondsAgo: number) => new Date(now - secondsAgo * SECOND).toISOString();
  return [
    { kind: 'tool-call', seq: 1, at: at(125), callId: 'toolu_01WritePrd000000000001', tool: 'Write', target: 'docs/product/features/agenda-partage.md' },
    { kind: 'tool-result', seq: 2, at: at(124), callId: 'toolu_01WritePrd000000000001', ok: true, detail: '142 lignes' },
    { kind: 'tool-call', seq: 3, at: at(65), callId: 'toolu_01CommitPrd00000000001', tool: 'Bash', target: 'git commit -m "docs(product) : agenda partagé"' },
    { kind: 'tool-result', seq: 4, at: at(63), callId: 'toolu_01CommitPrd00000000001', ok: true, detail: '1 fichier' },
    { kind: 'message', seq: 5, at: at(5), from: 'agent', text: 'Le PRD est écrit. J’envoie la branche pour ouvrir la PR de Conception.', final: true },
    { kind: 'permission-request', seq: PERMISSION_REQUEST.seq, at: at(0), requestId: PERMISSION_REQUEST.requestId, tool: 'Bash', command: 'git push origin design/agenda-partage' },
  ];
};

type SessionState = 'starting' | 'stopped' | 'interrupted';

/**
 * The Pilote of « À toi » (its nine Décisions), Personal OS followed, both
 * Comptes IA connected (the Cadre's Runner card names them), a trusted
 * Appareil paired with the Runner, and the Session in `state`, its log held
 * by the fake Runner for that Appareil (`log`, the mockup's by default);
 * `online`, the Runner connects (and starts a `starting` Session, `active`
 * then, `waiting` when its log ends on a request), else it is offline since 14:02.
 */
const seedSession = async (ctx: ScenarioContext, state: SessionState, online: boolean, log: (now: number) => EngineEvent[] = sessionLog): Promise<ScenarioSeed> => {
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
  const events = log(now);
  // A log that holds requests: « À toi »'s requests of this Session are its own (the mockup's question, of `session-question`, or none).
  const requests = events.flatMap((event) => (event.kind === 'question' || event.kind === 'permission-request' ? [event.requestId] : []));
  if (requests.length > 0) {
    await ctx.prisma.unscoped.decision.deleteMany({ where: { pilotId, params: { path: ['sessionId'], equals: SESSION_ID }, subjectId: { notIn: requests } } });
  }
  ctx.fakes.runner.holdSession(SESSION_ID, { runnerPrivateKey, holders: [Buffer.from(device.publicKey, 'base64url')], events });
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

/**
 * The agent's question waiting (`session`, state `question`, SESSION-3): its
 * options in the panel, the Composer « Ou réponds avec tes mots », and its
 * Décision « Question de l’agent » in « À toi », raised by the Runner's `session.waiting`.
 */
export const sessionQuestion = defineScenario({
  name: 'session-question',
  path: SESSION_PATH,
  seed: (ctx) => seedSession(ctx, 'starting', true, questionLog),
});

/** A `git push` waiting for the Pilote's permission (`session`, state `permission`): its three buttons, its Décision « Permission demandée ». */
export const sessionPermission = defineScenario({
  name: 'session-permission',
  path: SESSION_PATH,
  seed: (ctx) => seedSession(ctx, 'starting', true, permissionLog),
});
