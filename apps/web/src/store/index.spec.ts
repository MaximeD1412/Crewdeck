import {
  type AgentSession,
  type CodeChange,
  DEFAULT_ACCOUNT_SETTINGS,
  type Me,
  type Milestone,
  type PhaseRun,
  PROCESS_CREWDECK,
  PROCESS_CREWDECK_NAME,
  type ProjectProcess,
  type State,
  type StepRun,
  type Ticket,
} from '@crewdeck/contracts';
import { store } from './index.js';

const PROJECT = '018f6b2a-7c3d-7e4f-9a1b-2c3d4e5f6a80';

const SESSION: AgentSession = {
  id: '01900000-0000-7000-8000-0000000000c1',
  projectId: PROJECT,
  role: 'code',
  engine: 'claude-code',
  model: 'claude-opus-5-5',
  title: 'Le panier garde ses articles',
  state: 'active',
  interruptedReason: null,
  outcome: null,
  error: null,
  stepRunId: null,
  branch: 'feat/12-panier',
  startedAt: '2026-11-15T07:00:00.000Z',
  endedAt: null,
};
const AT = '2026-11-15T08:00:00.000Z';
const SHA = 'a'.repeat(40);
const PILOT: Me = { id: '018f6b2a-7c3d-7e4f-9a1b-2c3d4e5f6a7b', displayName: 'octocat', avatarUrl: null, timeZone: 'Europe/Paris', gettingStartedStep: 'done', identities: [] };

const TICKET: Ticket = {
  id: '018f6b2a-7c3d-7e4f-9a1b-2c3d4e5f6a90',
  projectId: PROJECT,
  source: 'github',
  number: 42,
  title: 'Connexion GitHub',
  titleSealed: null,
  state: 'open',
  stateReason: null,
  closedAt: null,
  readyMark: true,
  ready: true,
  labels: ['ready-for-agent'],
  labelsSealed: null,
  priority: null,
  size: null,
  milestoneNumber: 3,
  blockedBy: [],
  parentNumber: null,
  branchPrefix: 'feat',
  visualReview: false,
  sourceCreatedAt: AT,
  sourceUpdatedAt: AT,
  updatedAt: AT,
};

const MILESTONE: Milestone = {
  id: '018f6b2a-7c3d-7e4f-9a1b-2c3d4e5f6a91',
  projectId: PROJECT,
  source: 'github',
  number: 3,
  rank: 3,
  title: 'MVP',
  titleSealed: null,
  state: 'open',
  dueOn: null,
  openCount: 1,
  closedCount: 0,
  closedAt: null,
};

const CHANGE: CodeChange = {
  id: '018f6b2a-7c3d-7e4f-9a1b-2c3d4e5f6a92',
  projectId: PROJECT,
  source: 'github',
  number: 57,
  ticketNumber: 42,
  title: 'Connexion GitHub',
  titleSealed: null,
  state: 'open',
  headRef: 'feat/42-connexion-github',
  baseRef: 'develop',
  headSha: SHA,
  checks: 'pending',
  checksSha: SHA,
  mergedAt: null,
  mergedBy: null,
  mergeSha: null,
  sourceCreatedAt: AT,
  updatedAt: AT,
};

const PROCESS: ProjectProcess = {
  id: PROJECT,
  active: { number: 1, definition: PROCESS_CREWDECK, sealed: null, activatedAt: AT, activatedBy: 'creation', templateName: PROCESS_CREWDECK_NAME },
  draft: null,
  sources: { ticket: { source: 'github', since: AT }, code: { source: 'github', since: AT } },
};

const PHASE_RUN: PhaseRun = {
  id: '01900000-0000-7000-8000-0000000000a1',
  projectId: PROJECT,
  processVersion: 1,
  builtinTemplate: null,
  parentPhaseRunId: null,
  phaseId: 'ph-dev',
  itemType: 'ticket',
  itemId: '42',
  state: 'running',
  waitingOn: null,
  loopBacks: [],
  startedAt: AT,
  endedAt: null,
};

const STEP_RUN: StepRun = {
  id: '01900000-0000-7000-8000-0000000000b1',
  projectId: PROJECT,
  phaseRunId: PHASE_RUN.id,
  stepId: 'st-code',
  kind: 'code',
  iteration: 1,
  state: 'running',
  inputs: [{ portId: 'ticket', artifacts: [{ portId: 'ticket', type: 'ticket', id: '42' }], absent: false }],
  outputs: [],
  verdict: null,
  failure: null,
  reason: null,
  sessionId: null,
  canAskChanges: false,
  startedAt: AT,
  endedAt: null,
};

const SNAPSHOT: State = {
  seq: 1,
  pilot: PILOT,
  runner: null,
  'runner-link': null,
  'ai-account': [],
  'mcp-server': [],
  devices: [],
  'push-subscriptions': [],
  projects: [],
  processes: [PROCESS],
  phaseRuns: [PHASE_RUN],
  stepRuns: [STEP_RUN],
  repositories: [],
  decisions: [],
  tickets: [TICKET],
  milestones: [MILESTONE],
  codeChanges: [CHANGE],
  sessions: [SESSION],
  settings: { ...DEFAULT_ACCOUNT_SETTINGS, timeZone: 'Europe/Paris' },
};

describe('the page’s store', () => {
  it('holds the Tickets, the milestones and the changes of code by id, from the snapshot then their events', () => {
    store.applySnapshot(SNAPSHOT);
    expect([...(store.getState().slices.ticket?.values() ?? [])]).toEqual([TICKET]);
    expect([...(store.getState().slices.milestone?.values() ?? [])]).toEqual([MILESTONE]);
    expect([...(store.getState().slices['code-change']?.values() ?? [])]).toEqual([CHANGE]);

    store.applyEvent({ seq: 2, type: 'code-change.upserted', payload: { ...CHANGE, checks: 'passed' }, at: AT });
    store.applyEvent({ seq: 3, type: 'ticket.removed', payload: { id: TICKET.id }, at: AT });

    expect(store.getState().slices['code-change']?.get(CHANGE.id)).toMatchObject({ checks: 'passed' });
    expect(store.getState().slices.ticket?.size).toBe(0);
  });

  it('holds each Projet’s Process by the Projet’s id, from the snapshot, replaced whole by process.upserted', () => {
    store.applySnapshot(SNAPSHOT);
    expect(store.getState().slices.process?.get(PROJECT)).toEqual(PROCESS);

    const saved: ProjectProcess = { ...PROCESS, draft: { definition: PROCESS_CREWDECK, sealed: null, revision: 1, baseVersion: 1, updatedAt: AT } };
    expect(store.applyEvent({ seq: 2, type: 'process.upserted', payload: saved, at: AT })).toBe('applied');

    expect(store.getState().slices.process?.size).toBe(1);
    expect(store.getState().slices.process?.get(PROJECT)).toEqual(saved);
  });

  it('holds the PhaseRuns and the StepRuns by id, from the snapshot then their events', () => {
    store.applySnapshot(SNAPSHOT);
    expect(store.getState().slices['phase-run']?.get(PHASE_RUN.id)).toEqual(PHASE_RUN);
    expect(store.getState().slices['step-run']?.get(STEP_RUN.id)).toEqual(STEP_RUN);

    const done: StepRun = { ...STEP_RUN, state: 'done', outputs: [{ portId: 'changement', type: 'code-change', id: '57' }], endedAt: AT };
    expect(store.applyEvent({ seq: 2, type: 'step-run.upserted', payload: done, at: AT })).toBe('applied');

    expect(store.getState().slices['step-run']?.get(STEP_RUN.id)).toEqual(done);
    expect(store.getState().slices['phase-run']?.get(PHASE_RUN.id)).toEqual(PHASE_RUN);
  });

  it('drops a PhaseRun once finished, with its StepRuns, as the snapshot at that seq would, and holds them again when a retry reopens it', () => {
    const OTHER: PhaseRun = { ...PHASE_RUN, id: '01900000-0000-7000-8000-0000000000a2', itemId: '43' };
    store.applySnapshot({ ...SNAPSHOT, phaseRuns: [PHASE_RUN, OTHER] });
    const failed: StepRun = { ...STEP_RUN, state: 'failed', failure: 'agent-failed', endedAt: AT };
    const ended: PhaseRun = { ...PHASE_RUN, state: 'failed', endedAt: AT };
    store.applyEvent({ seq: 2, type: 'step-run.upserted', payload: failed, at: AT });
    store.applyEvent({ seq: 3, type: 'phase-run.upserted', payload: ended, at: AT });

    const followed = store.getState().slices;
    store.applySnapshot({ ...SNAPSHOT, seq: 3, phaseRuns: [OTHER], stepRuns: [] });
    const reloaded = store.getState().slices;
    expect([...(followed['phase-run']?.values() ?? [])]).toEqual([...(reloaded['phase-run']?.values() ?? [])]);
    expect([...(followed['step-run']?.values() ?? [])]).toEqual([]);
    // A StepRun of a PhaseRun the page no longer holds is not kept.
    expect(store.applyEvent({ seq: 4, type: 'step-run.upserted', payload: failed, at: AT })).toBe('applied');
    expect(store.getState().slices['step-run']?.size).toBe(0);

    // `retry`: the PhaseRun `running` again, then each of its StepRuns published anew.
    const retried: StepRun = { ...STEP_RUN, id: '01900000-0000-7000-8000-0000000000b2' };
    store.applyEvent({ seq: 5, type: 'phase-run.upserted', payload: PHASE_RUN, at: AT });
    store.applyEvent({ seq: 6, type: 'step-run.upserted', payload: failed, at: AT });
    store.applyEvent({ seq: 7, type: 'step-run.upserted', payload: retried, at: AT });

    expect([...(store.getState().slices['phase-run']?.keys() ?? [])].sort()).toEqual([PHASE_RUN.id, OTHER.id]);
    expect([...(store.getState().slices['step-run']?.values() ?? [])]).toEqual([failed, retried]);
  });

  it('holds the Sessions by id, from the snapshot then their events', () => {
    store.applySnapshot(SNAPSHOT);
    expect([...(store.getState().slices['agent-session']?.values() ?? [])]).toEqual([SESSION]);

    const interrupted: AgentSession = { ...SESSION, state: 'interrupted', interruptedReason: 'runner-offline' };
    store.applyEvent({ seq: 2, type: 'agent-session.upserted', payload: interrupted, at: AT });

    expect(store.getState().slices['agent-session']?.get(SESSION.id)).toEqual(interrupted);
  });
});
