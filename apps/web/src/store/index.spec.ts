import type { CodeChange, Me, Milestone, State, Ticket } from '@crewdeck/contracts';
import { store } from './index.js';

const PROJECT = '018f6b2a-7c3d-7e4f-9a1b-2c3d4e5f6a80';
const AT = '2026-11-15T08:00:00.000Z';
const SHA = 'a'.repeat(40);
const PILOT: Me = { id: '018f6b2a-7c3d-7e4f-9a1b-2c3d4e5f6a7b', login: 'octocat', avatarUrl: null, timeZone: 'Europe/Paris', gettingStartedStep: 'done' };

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

const SNAPSHOT: State = {
  seq: 1,
  pilot: PILOT,
  runner: null,
  'runner-link': null,
  'ai-account': [],
  devices: [],
  projects: [],
  repositories: [],
  decisions: [],
  tickets: [TICKET],
  milestones: [MILESTONE],
  codeChanges: [CHANGE],
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
});
