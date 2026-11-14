import type { PrismaService } from '../prisma/prisma.service.js';
import { Registry } from './registry.js';
import type { StateContributor } from './state-contributors.js';
import { StateController } from './state.controller.js';

const pilotSlice: StateContributor = { key: 'pilot', snapshot: () => Promise.reject(new Error('not read at boot')) };
const runnerSlice: StateContributor = { ...pilotSlice, key: 'runner' };
const linkSlice: StateContributor = { ...pilotSlice, key: 'runner-link' };
const aiAccountSlice: StateContributor = { ...pilotSlice, key: 'ai-account' };
const devicesSlice: StateContributor = { ...pilotSlice, key: 'devices' };
const projectsSlice: StateContributor = { ...pilotSlice, key: 'projects' };
const repositoriesSlice: StateContributor = { ...pilotSlice, key: 'repositories' };
const decisionsSlice: StateContributor = { ...pilotSlice, key: 'decisions' };
const all = [pilotSlice, runnerSlice, linkSlice, aiAccountSlice, devicesSlice, projectsSlice, repositoriesSlice, decisionsSlice];

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
    expect(() => boot([])).toThrow(/missing \[pilot, runner, runner-link, ai-account, devices, projects, repositories, decisions\]/);
    expect(() => boot([pilotSlice])).toThrow(/missing \[runner, runner-link, ai-account, devices, projects, repositories, decisions\]/);
    expect(() => boot([...all, pilotSlice])).toThrow(/repeated \[pilot\]/);
    expect(() => boot([pilotSlice, runnerSlice, { ...pilotSlice, key: 'ideas' as never }])).toThrow(/repeated \[ideas\]/);
  });
});
