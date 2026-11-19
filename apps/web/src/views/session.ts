import { AGENT_ROLES, type AgentSession, type EngineEvent } from '@crewdeck/contracts';
import {
  Banner,
  Button,
  Composer,
  Empty,
  formatHour,
  Message,
  PermissionRequest,
  Question,
  t,
  ToolCall,
  type ComposantData,
  type MessageKey,
  type Session,
} from '@crewdeck/sdk';
import type { PlacedNode } from '../placed.js';
import type { Slices } from '../store/store.js';

export type SessionData = ComposantData<typeof Session>;
type ComposerData = ComposantData<typeof Composer>;

/** A message the Pilote sent from this tab: the Runner keeps no log of it, the tab shows it after the event it followed. */
export interface PilotMessage {
  readonly text: string;
  readonly at: string;
  /** The `seq` of the last event shown when it was sent, 0 before any. */
  readonly afterSeq: number;
}

export interface SessionViewInput {
  readonly session: AgentSession;
  readonly slices: Pick<Partial<Slices>, 'project' | 'runner' | 'settings'>;
  /** The relay's decrypted events, in `seq` order (`SessionSubscription.events`). */
  readonly events: readonly EngineEvent[];
  readonly sent: readonly PilotMessage[];
  readonly now: Date;
}

/** The `Session` Composant's data and what the core places in it: the conversation, then its Composer. */
export interface SessionView {
  readonly data: SessionData;
  readonly children: readonly PlacedNode[];
}

const SHOWN_STATE: Readonly<Record<AgentSession['state'], SessionData['state']>> = {
  starting: 'active',
  active: 'active',
  waiting: 'waiting',
  stopped: 'stopped',
  interrupted: 'interrupted',
  ended: 'stopped',
};

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

/** « 42 s », « 3 min », « 2 h ». */
const duration = (ms: number): string => {
  const elapsed = Math.max(0, ms);
  if (elapsed < MINUTE) return t('session.duration.seconds', { count: String(Math.floor(elapsed / SECOND)) });
  if (elapsed < HOUR) return t('session.duration.minutes', { count: String(Math.floor(elapsed / MINUTE)) });
  return t('session.duration.hours', { count: String(Math.floor(elapsed / HOUR)) });
};

const RUNNING: ReadonlySet<AgentSession['state']> = new Set(['active', 'waiting']);

const isDefaultRole = (role: string): role is (typeof AGENT_ROLES)[number] => (AGENT_ROLES as readonly string[]).includes(role);

export const roleName = (role: AgentSession['role'], settings: Slices['settings'] | undefined): string =>
  isDefaultRole(role) ? t(`role.${role}`) : (settings?.customRoles.find((custom) => custom.id === role)?.name ?? role);

const engineName = (engine: AgentSession['engine']): string => t(`engine.${engine}` as MessageKey);

const composer = (placeholder: MessageKey, state: ComposerData['state'] = 'idle'): PlacedNode => ({
  tag: Composer.tag,
  slot: 'composer',
  // The microphone is IDEE-4's.
  data: { placeholder: t(placeholder), hint: null, state, value: '', dictation: false } satisfies ComposerData,
});

const button = (label: string, icon: 'server' | 'x'): PlacedNode => ({
  tag: Button.tag,
  slot: 'actions',
  data: { label, variant: 'secondary', size: 'md', icon } satisfies ComposantData<typeof Button>,
});

/** The agent's message being streamed: where it shows, its text so far, when it began. */
interface Streaming {
  readonly index: number;
  readonly text: string;
  readonly at: string;
}

const message = (from: 'agent' | 'pilote', text: string, at: string): PlacedNode => ({ tag: Message.tag, data: { from, text, at } });

type Answer = Extract<EngineEvent, { kind: 'answer' }>;
type Request = Extract<EngineEvent, { kind: 'question' | 'permission-request' }>;

/** The answers of the log, by request: the Moteur took them (SESSION-3). */
const answersOf = (events: readonly EngineEvent[]): ReadonlyMap<string, Answer> =>
  new Map(events.flatMap((event) => (event.kind === 'answer' ? [[event.requestId, event] as const] : [])));

/**
 * The requests a turn ended on with no answer: a stop (or the Runner's end)
 * withdrew them, the run resumed after never taking them (SESSION-3).
 */
const withdrawnOf = (events: readonly EngineEvent[]): ReadonlySet<string> => {
  const open = new Set<string>();
  const withdrawn = new Set<string>();
  for (const event of events) {
    if (event.kind === 'question' || event.kind === 'permission-request') open.add(event.requestId);
    else if (event.kind === 'answer') open.delete(event.requestId);
    else if (event.kind === 'result') {
      for (const id of open) withdrawn.add(id);
      open.clear();
    }
  }
  return withdrawn;
};

/** The question still waiting for the Pilote, the last one of the current turn: the Composer's text answers it. */
export const pendingQuestion = (events: readonly EngineEvent[], state: AgentSession['state']): Extract<EngineEvent, { kind: 'question' }> | null => {
  if (!RUNNING.has(state)) return null;
  const answers = answersOf(events);
  const withdrawn = withdrawnOf(events);
  return (
    events.findLast(
      (event): event is Extract<EngineEvent, { kind: 'question' }> => event.kind === 'question' && !answers.has(event.requestId) && !withdrawn.has(event.requestId),
    ) ?? null
  );
};

const asked = (request: Request): string =>
  request.kind === 'question' ? request.title : t('session.permission.asked', { tool: request.tool, command: request.command });

/** What the Pilote answered, as they read it: « Tu as répondu : … », « Autorisé »… */
const answered = (answer: Answer): string =>
  answer.decision !== undefined
    ? t(`session.permission.${answer.decision}`)
    : t('session.question.answered', { answer: answer.text ?? answer.options?.join(', ') ?? '' });

/** A request waiting: the `Question` (its options by their index) or the `PermissionRequest`. */
const pendingNode = (request: Request): PlacedNode =>
  request.kind === 'question'
    ? {
        tag: Question.tag,
        data: {
          id: request.requestId,
          kicker: request.index !== undefined && request.count !== undefined ? t('session.question.kicker', { index: String(request.index), count: String(request.count) }) : null,
          title: request.title,
          options: request.options.map((option, index) => ({ id: String(index), label: option.label, detail: option.detail ?? null, selected: false })),
          multiple: request.multiple,
        } satisfies ComposantData<typeof Question>,
      }
    : { tag: PermissionRequest.tag, data: { id: request.requestId, tool: request.tool, command: request.command } satisfies ComposantData<typeof PermissionRequest> };

/**
 * The conversation from the events: the agent's messages (its deltas joined
 * while it streams, then the whole message in their place, a turn cut
 * before it ending it), its tool calls
 * (the result's detail on its call), its questions and permission requests
 * (SESSION-3: the `Question` or the `PermissionRequest` while it waits and the
 * Session runs; once answered, what it asked then the answer given, as the
 * Pilote's line; withdrawn, a turn ended on it unanswered, what it asked then
 * that it stayed unanswered; the agent's message in a Session that no longer
 * runs), and
 * the Pilote's messages after the event they followed. Usage, results and
 * the rest show nothing.
 */
const conversation = (events: readonly EngineEvent[], sent: readonly PilotMessage[], running: boolean): PlacedNode[] => {
  const nodes: PlacedNode[] = [];
  const answers = answersOf(events);
  const withdrawn = withdrawnOf(events);
  const calls = new Map<string, number>();
  let streaming: Streaming | null = null;
  let pending = [...sent];
  const flushSent = (before: number) => {
    for (const pilot of pending.filter((candidate) => candidate.afterSeq < before)) nodes.push(message('pilote', pilot.text, pilot.at));
    pending = pending.filter((candidate) => candidate.afterSeq >= before);
  };
  for (const event of events) {
    flushSent(event.seq);
    // A turn cut (an error, an interrupted result) or anything shown ends the message being streamed: the next one, once resumed, is apart.
    if (event.kind !== 'message' && event.kind !== 'usage') streaming = null;
    switch (event.kind) {
      case 'message': {
        // The loop sets it: the flow analysis alone would see it always null.
        const open = streaming as Streaming | null;
        const at = open?.at ?? event.at;
        const text = event.final ? event.text : (open?.text ?? '') + event.text;
        const node = message('agent', text, at);
        if (open) nodes[open.index] = node;
        else nodes.push(node);
        streaming = event.final ? null : { index: open?.index ?? nodes.length - 1, text, at };
        break;
      }
      case 'tool-call':
        calls.set(event.callId, nodes.length);
        nodes.push({ tag: ToolCall.tag, data: { tool: event.tool, target: event.target ?? null, detail: event.detail ?? null } });
        break;
      case 'tool-result': {
        const index = calls.get(event.callId);
        const call = index === undefined ? undefined : nodes[index];
        if (index !== undefined && call && event.detail !== undefined) {
          nodes[index] = { ...call, data: { ...(call.data as ComposantData<typeof ToolCall>), detail: event.detail } };
        }
        break;
      }
      case 'question':
      case 'permission-request': {
        const answer = answers.get(event.requestId);
        if (!answer && running && !withdrawn.has(event.requestId)) {
          nodes.push(pendingNode(event));
          break;
        }
        nodes.push(message('agent', asked(event), event.at));
        if (answer) nodes.push(message('pilote', answered(answer), answer.at));
        else if (withdrawn.has(event.requestId)) nodes.push(message('agent', t('session.request.withdrawn'), event.at));
        break;
      }
      case 'error':
        nodes.push(message('agent', t('session.engineError', { message: event.message }), event.at));
        break;
      default:
        break;
    }
  }
  flushSent(Number.POSITIVE_INFINITY);
  return nodes;
};

/**
 * The Session panel (US-9, US-60), pure: its head (title, « Projet · Rôle ·
 * Moteur », its state, `starting` shown as active and `ended` as stopped),
 * the conversation, « <Moteur> travaille · <durée> » while it runs, the stop
 * Banner once the Pilote stopped it, then its Composer. While the Runner is
 * not online, only its title and state: « Conversation sur ton Runner » in
 * place of the conversation, the Composer and « Reprendre » disabled.
 */
export const sessionView = ({ session, slices, events, sent, now }: SessionViewInput): SessionView => {
  const online = slices.runner?.state === 'online';
  const engine = engineName(session.engine);
  const base = t('session.meta', {
    project: slices.project?.get(session.projectId)?.displayName ?? '',
    role: roleName(session.role, slices.settings),
    engine,
  });
  const state = SHOWN_STATE[session.state];
  const lastAt = events.at(-1)?.at ?? session.startedAt;
  const data: SessionData = {
    id: session.id,
    title: session.title,
    meta: online ? base : t('session.meta.offline', { meta: base }),
    state,
    resumeDisabledReason: !online
      ? t('session.resumeDisabled.offline')
      : session.state === 'ended'
        ? t('session.resumeDisabled.ended')
        : null,
    resumeLabel: null,
    resumeIcon: null,
    status: online && state === 'active' ? t('session.working', { engine, duration: duration(now.getTime() - Date.parse(lastAt)) }) : null,
    // « Agrandir » is not at the MVP.
    expandable: false,
  };
  if (!online) {
    return {
      data,
      children: [
        {
          tag: Empty.tag,
          data: { icon: 'lock', title: t('session.offline.title') } satisfies ComposantData<typeof Empty>,
          text: t('session.offline.body'),
          children: [button(t('decision.runnerOffline.openRunner'), 'server')],
        },
        composer('session.composer.offline', 'disabled'),
      ],
    };
  }
  const children = conversation(events, sent, RUNNING.has(session.state));
  if (session.state === 'stopped' && session.endedAt !== null) {
    children.push({
      tag: Banner.tag,
      data: { tone: 'neutral', title: t('session.stopped.title', { time: formatHour(session.endedAt) }), icon: 'pause' } satisfies ComposantData<typeof Banner>,
      text: t('session.stopped.body'),
    });
  }
  if (state === 'active' || state === 'waiting') children.push(composer(pendingQuestion(events, session.state) ? 'session.question.composer' : 'session.composer.running'));
  else if (session.state !== 'ended') children.push(composer('session.composer.stopped'));
  return { data, children };
};

/** A Session the Pilote does not have (another's id, or none): « Session introuvable », and « Fermer ». */
export const sessionNotFoundView = (): PlacedNode => ({
  tag: Empty.tag,
  data: { icon: 'alert', title: t('session.notFound.title') } satisfies ComposantData<typeof Empty>,
  text: t('session.notFound.body'),
  children: [button(t('session.close'), 'x')],
});
