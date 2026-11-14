import type { Decision, WaitingProject } from '@crewdeck/contracts';
import { COMPOSANTS, formatHour } from '@crewdeck/sdk';
import { aToiView } from '../a-toi.js';
import { decisionViews } from './registry.js';
import { runnerOfflineView, waitingItemText } from './runner-offline.js';

const NOW = new Date('2026-11-11T13:30:00.000Z');
const SINCE = '2026-11-11T13:02:00.000Z';

const PROJECTS: WaitingProject[] = [
  { projectId: '019a6f1e-7c3d-7e4f-9a1b-2c3d4e5f6a01', name: 'Crewdeck', items: [{ kind: 'ticket-in-progress', number: 44 }] },
  {
    projectId: '019a6f1e-7c3d-7e4f-9a1b-2c3d4e5f6a02',
    name: 'Personal OS',
    items: [
      { kind: 'ticket-in-progress', number: 53 },
      { kind: 'tickets-ready', count: 2 },
    ],
  },
  { projectId: '019a6f1e-7c3d-7e4f-9a1b-2c3d4e5f6a03', name: 'Site mairie', items: [{ kind: 'ticket-interrupted', number: 47 }] },
];

const offline = (projects: WaitingProject[] = PROJECTS, params: Record<string, string> = {}): Decision => ({
  id: '0193a4f2-7c1e-7a10-8b2c-000000000001',
  kind: 'runner-offline',
  projectId: null,
  projectName: null,
  subjectType: 'runner',
  subjectId: '019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6aff',
  label: `Le travail attend dans ${projects.length} Projets`,
  metaParts: [`${projects.length} Projets`],
  tone: 'halt',
  link: '/runner',
  params: { since: SINCE, projects: JSON.stringify(projects), ...params },
  state: 'open',
  outcome: null,
  createdAt: '2026-11-11T13:02:45.000Z',
  resolvedAt: null,
});

describe('the « Runner hors ligne » Décision in « À toi »', () => {
  it('is registered: « N Projets · depuis HH:MM », what waits in each Projet, « Voir le Runner » as primary', () => {
    const data = aToiView([offline()], {}, { runnerOnline: false, now: NOW });

    expect(COMPOSANTS.PageAToi.data.parse(data)).toEqual(data);
    expect(data.decisions).toEqual([
      {
        id: offline().id,
        kind: 'Runner hors ligne',
        title: 'Le travail attend dans 3 Projets',
        meta: `3 Projets · depuis ${formatHour(SINCE)}`,
        context: 'Crewdeck : #44 en cours · Personal OS : #53 en cours, 2 Tickets prêts · Site mairie : #47 interrompu',
        tone: 'halt',
        icon: 'server',
        actions: [{ id: 'open-runner', label: 'Voir le Runner', primary: true, disabledReason: null }],
      },
    ]);
    expect(decisionViews.viewOf('runner-offline')).toBe(runnerOfflineView);
  });

  it('« Voir le Runner » leads to /runner, even with the Runner offline', () => {
    const navigate = vi.fn();
    void runnerOfflineView.actions[0]?.run(offline(), { navigate });
    expect(navigate).toHaveBeenCalledWith('/runner');
    expect(runnerOfflineView.actions[0]?.needsRunner).toBeUndefined();
  });

  it('says « 1 Projet », and no context for malformed Projets, the time of its creation without `since`', () => {
    expect(runnerOfflineView.meta?.(offline(PROJECTS.slice(0, 1)), NOW)).toBe(`1 Projet · depuis ${formatHour(SINCE)}`);
    const broken = offline(PROJECTS, { projects: '{nope', since: 'hier' });
    expect(runnerOfflineView.context?.(broken)).toBeNull();
    expect(runnerOfflineView.meta?.(broken, NOW)).toBe(`0 Projets · depuis ${formatHour('2026-11-11T13:02:45.000Z')}`);
  });

  it('phrases each kind of waiting work, by its number or counted', () => {
    expect(
      [
        { kind: 'ticket-in-progress', number: 44 },
        { kind: 'ticket-in-progress', count: 3 },
        { kind: 'tickets-ready', count: 1 },
        { kind: 'tickets-ready', count: 2 },
        { kind: 'tickets-ready', number: 9 },
        { kind: 'ticket-interrupted', number: 47 },
        { kind: 'ticket-interrupted', count: 2 },
        { kind: 'ideas-waiting', count: 1 },
        { kind: 'ideas-waiting', count: 4 },
        { kind: 'ideas-waiting' },
        { kind: 'step-queued', number: 12 },
        { kind: 'step-queued', count: 2 },
      ].map((item) => waitingItemText(item as WaitingProject['items'][number])),
    ).toEqual([
      '#44 en cours',
      '3 Tickets en cours',
      '1 Ticket prêt',
      '2 Tickets prêts',
      '#9 prêt',
      '#47 interrompu',
      '2 Tickets interrompus',
      '1 Idée en attente',
      '4 Idées en attente',
      '1 Idée en attente',
      '#12 en file',
      '2 Étapes en file',
    ]);
  });
});
