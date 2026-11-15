import { parseWaitingProjects, type WaitingProject, zDecision } from '@crewdeck/contracts';
import type { PinoLogger } from 'nestjs-pino';
import { runnerOfflineDecision } from './runner-offline.service.js';
import { RunnerWaitingWork } from './waiting-work.js';

const PILOT = '019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6a00';
const CREWDECK = '019a6f1e-7c3d-7e4f-9a1b-2c3d4e5f6a01';
const PERSONAL_OS = '019a6f1e-7c3d-7e4f-9a1b-2c3d4e5f6a02';
const RUNNER = { id: '019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6aff', lastSeenAt: new Date('2026-11-11T13:02:00.000Z') };

const logger = { error: vi.fn() };
const registry = () => new RunnerWaitingWork(logger as unknown as PinoLogger);

describe('RunnerWaitingWork', () => {
  it('merges what every provider declares by Projet, the Projets by name, « Idées » last', async () => {
    const work = registry();
    const asked: string[] = [];
    work.register({
      key: 'loops',
      projectsWaiting: (pilotId) => {
        asked.push(pilotId);
        return Promise.resolve([
          { projectId: PERSONAL_OS, name: 'Personal OS', items: [{ kind: 'ticket-in-progress', number: 53 }] },
          { projectId: CREWDECK, name: 'Crewdeck', items: [{ kind: 'ticket-in-progress', number: 44 }] },
        ]);
      },
    });
    work.register({
      key: 'ideas',
      projectsWaiting: () => Promise.resolve([{ projectId: null, name: 'Idées', items: [{ kind: 'ideas-waiting', count: 2 }] }]),
    });
    work.register({
      key: 'steps',
      projectsWaiting: () => Promise.resolve([{ projectId: PERSONAL_OS, name: 'Personal OS', items: [{ kind: 'tickets-ready', count: 2 }] }]),
    });

    expect(await work.collect(PILOT)).toEqual([
      { projectId: CREWDECK, name: 'Crewdeck', items: [{ kind: 'ticket-in-progress', number: 44 }] },
      {
        projectId: PERSONAL_OS,
        name: 'Personal OS',
        items: [
          { kind: 'ticket-in-progress', number: 53 },
          { kind: 'tickets-ready', count: 2 },
        ],
      },
      { projectId: null, name: 'Idées', items: [{ kind: 'ideas-waiting', count: 2 }] },
    ]);
    expect(asked).toEqual([PILOT]);
  });

  it('gives no Projet without a provider, nor for a Projet whose provider has nothing', async () => {
    const work = registry();
    expect(await work.collect(PILOT)).toEqual([]);
    work.register({ key: 'loops', projectsWaiting: () => Promise.resolve([{ projectId: CREWDECK, name: 'Crewdeck', items: [] }]) });
    expect(await work.collect(PILOT)).toEqual([]);
  });

  it('keeps what the others declare when a provider fails, and logs it', async () => {
    const work = registry();
    work.register({ key: 'broken', projectsWaiting: () => Promise.reject(new Error('boom')) });
    work.register({ key: 'loops', projectsWaiting: () => Promise.resolve([{ projectId: CREWDECK, name: 'Crewdeck', items: [{ kind: 'tickets-ready', count: 1 }] }]) });

    expect(await work.collect(PILOT)).toEqual([{ projectId: CREWDECK, name: 'Crewdeck', items: [{ kind: 'tickets-ready', count: 1 }] }]);
    expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({ provider: 'broken' }), expect.any(String));
  });

  it('refuses a second provider with the same key, and removes one with what register returns', async () => {
    const work = registry();
    const remove = work.register({ key: 'loops', projectsWaiting: () => Promise.resolve([{ projectId: CREWDECK, name: 'Crewdeck', items: [{ kind: 'tickets-ready', count: 1 }] }]) });
    expect(() => work.register({ key: 'loops', projectsWaiting: () => Promise.resolve([]) })).toThrow(/loops/);

    remove();

    expect(await work.collect(PILOT)).toEqual([]);
  });
});

describe('runnerOfflineDecision', () => {
  const projects: WaitingProject[] = [
    { projectId: CREWDECK, name: 'Crewdeck', items: [{ kind: 'ticket-in-progress', number: 44 }] },
    { projectId: PERSONAL_OS, name: 'Personal OS', items: [{ kind: 'tickets-ready', count: 2 }] },
    { projectId: null, name: 'Idées', items: [{ kind: 'ideas-waiting', count: 3 }] },
  ];

  it('is the halt Décision of the Runner, its Projets counted, since its last heartbeat, leading to /runner', () => {
    const input = runnerOfflineDecision(RUNNER, projects);

    expect(input).toEqual({
      kind: 'runner-offline',
      projectId: null,
      projectName: null,
      subjectType: 'runner',
      subjectId: RUNNER.id,
      label: 'Le travail attend dans 3 Projets',
      metaParts: ['3 Projets'],
      tone: 'halt',
      link: '/runner',
      params: { since: '2026-11-11T13:02:00.000Z', projects: JSON.stringify(projects) },
    });
    expect(parseWaitingProjects(input.params['projects'])).toEqual(projects);
    expect(zDecision.omit({ id: true, state: true, outcome: true, createdAt: true, resolvedAt: true }).safeParse(input).success).toBe(true);
  });

  it('says « 1 Projet » for one', () => {
    expect(runnerOfflineDecision(RUNNER, projects.slice(0, 1))).toMatchObject({ label: 'Le travail attend dans 1 Projet', metaParts: ['1 Projet'] });
  });
});
