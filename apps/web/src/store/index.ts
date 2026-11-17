import { type Idea, type PhaseRun, type StepRun, UNFINISHED_PHASE_RUN_STATES, zState } from '@crewdeck/contracts';
import { holdsIdea } from './ideas.js';
import { createClient } from '../api/client.js';
import { createConnection } from './connection.js';
import { createStore } from './store.js';

/**
 * The page's store, its socket and its API client (ADR 0008, « Front data »):
 * one of each per page, the Pilote's. Each ticket registers its slices here;
 * pages read the store through their view function and send their commands
 * through `client`, never a fetch of their own.
 */
export const store = createStore();
store.registerSlice('pilot', { shape: 'single' });
store.registerSlice('runner', { shape: 'single' });
store.registerSlice('decision', { shape: 'collection', snapshotKey: 'decisions' });
store.registerSlice('runner-link', { shape: 'single' });
store.registerSlice('ai-account', { shape: 'collection' });
store.registerSlice('mcp-server', { shape: 'collection' });
store.registerSlice('device', { shape: 'collection', snapshotKey: 'devices' });
store.registerSlice('push-subscription', { shape: 'collection', snapshotKey: 'push-subscriptions' });
store.registerSlice('project', { shape: 'collection', snapshotKey: 'projects' });
store.registerSlice('process', { shape: 'collection', snapshotKey: 'processes' });
// As `GET /api/state`: the unfinished PhaseRuns and their StepRuns, a finished one dropped with its StepRuns (PROCESS-4).
store.registerSlice('phase-run', { shape: 'collection', snapshotKey: 'phaseRuns', holds: (run) => (UNFINISHED_PHASE_RUN_STATES as readonly string[]).includes((run as PhaseRun).state) });
store.registerSlice('step-run', { shape: 'collection', snapshotKey: 'stepRuns', holds: (run, slices) => slices['phase-run']?.has((run as StepRun).phaseRunId) ?? false });
store.registerSlice('repository', { shape: 'collection', snapshotKey: 'repositories' });
store.registerSlice('idea', { shape: 'collection', snapshotKey: 'ideas', holds: (idea) => holdsIdea(idea as Idea) });
store.registerSlice('ticket', { shape: 'collection', snapshotKey: 'tickets' });
store.registerSlice('milestone', { shape: 'collection', snapshotKey: 'milestones' });
store.registerSlice('code-change', { shape: 'collection', snapshotKey: 'codeChanges' });
store.registerSlice('agent-session', { shape: 'collection', snapshotKey: 'sessions' });
store.registerSlice('settings', { shape: 'single' });

export const client = createClient({
  seq: () => store.getState().seq,
  onStale: () => connection.catchUp(),
});

export const connection = createConnection({ store, snapshot: () => client.query('/api/state', zState) });
