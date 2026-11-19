import type { PrismaService } from '../prisma/prisma.service.js';
import { Registry } from './registry.js';
import type { StateContributor } from './state-contributors.js';
import { StateController } from './state.controller.js';

const pilotSlice: StateContributor = { key: 'pilot', snapshot: () => Promise.reject(new Error('not read at boot')) };
const runnerSlice: StateContributor = { ...pilotSlice, key: 'runner' };
const linkSlice: StateContributor = { ...pilotSlice, key: 'runner-link' };
const aiAccountSlice: StateContributor = { ...pilotSlice, key: 'ai-account' };
const mcpServerSlice: StateContributor = { ...pilotSlice, key: 'mcp-server' };
const devicesSlice: StateContributor = { ...pilotSlice, key: 'devices' };
const projectsSlice: StateContributor = { ...pilotSlice, key: 'projects' };
const processesSlice: StateContributor = { ...pilotSlice, key: 'processes' };
const phaseRunsSlice: StateContributor = { ...pilotSlice, key: 'phaseRuns' };
const stepRunsSlice: StateContributor = { ...pilotSlice, key: 'stepRuns' };
const repositoriesSlice: StateContributor = { ...pilotSlice, key: 'repositories' };
const decisionsSlice: StateContributor = { ...pilotSlice, key: 'decisions' };
const ideasSlice: StateContributor = { ...pilotSlice, key: 'ideas' };
const settingsSlice: StateContributor = { ...pilotSlice, key: 'settings' };
const ticketsSlice: StateContributor = { ...pilotSlice, key: 'tickets' };
const milestonesSlice: StateContributor = { ...pilotSlice, key: 'milestones' };
const codeChangesSlice: StateContributor = { ...pilotSlice, key: 'codeChanges' };
const usageSlice: StateContributor = { ...pilotSlice, key: 'usage' };
const sessionsSlice: StateContributor = { ...pilotSlice, key: 'sessions' };
const vaultSlice: StateContributor = { ...pilotSlice, key: 'vault' };
const all = [
  pilotSlice,
  runnerSlice,
  linkSlice,
  aiAccountSlice,
  mcpServerSlice,
  devicesSlice,
  projectsSlice,
  processesSlice,
  phaseRunsSlice,
  stepRunsSlice,
  repositoriesSlice,
  decisionsSlice,
  ideasSlice,
  ticketsSlice,
  milestonesSlice,
  codeChangesSlice,
  sessionsSlice,
  settingsSlice,
  usageSlice,
  vaultSlice,
];

const boot = (contributors: StateContributor[]): void => {
  const registry = new Registry<StateContributor>();
  for (const contributor of contributors) registry.add(contributor);
  new StateController({} as PrismaService, registry).onApplicationBootstrap();
};

describe('StateController at boot', () => {
  it('starts when every slice of STATE_SLICES has one contributor', () => {
    expect(() => boot(all)).not.toThrow();
  });

  it('refuses to start with a slice missing, repeated or not in STATE_SLICES', () => {
    expect(() => boot([])).toThrow(/missing \[pilot, runner, runner-link, ai-account, mcp-server, devices, vault, projects, processes, phaseRuns, stepRuns, repositories, decisions, ideas, tickets, milestones, codeChanges, sessions, settings, usage\]/);
    expect(() => boot([pilotSlice])).toThrow(
      /missing \[runner, runner-link, ai-account, mcp-server, devices, vault, projects, processes, phaseRuns, stepRuns, repositories, decisions, ideas, tickets, milestones, codeChanges, sessions, settings, usage\]/,
    );
    expect(() => boot([...all, pilotSlice])).toThrow(/repeated \[pilot\]/);
    expect(() => boot([pilotSlice, runnerSlice, { ...pilotSlice, key: 'designs' as never }])).toThrow(/repeated \[designs\]/);
  });
});
