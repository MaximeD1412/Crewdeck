import type { Decision } from '@crewdeck/contracts';
import { COMPOSANTS, t } from '@crewdeck/sdk';
import { aToiView } from './a-toi.js';
import { createDecisionViews } from './decisions/registry.js';

const NOW = new Date('2026-11-11T10:00:00.000Z');
const minutesAgo = (n: number) => new Date(NOW.getTime() - n * 60_000).toISOString();

const CREWDECK = '019a6f1e-7c3d-7e4f-9a1b-2c3d4e5f6a01';
const PERSONAL_OS = '019a6f1e-7c3d-7e4f-9a1b-2c3d4e5f6a02';

const decision = (n: number, fields: Partial<Decision>): Decision => ({
  id: `0193a4f2-7c1e-7a10-8b2c-00000000000${n}`,
  kind: 'ticket-blocked',
  projectId: CREWDECK,
  projectName: 'Crewdeck',
  subjectType: 'ticket',
  subjectId: String(n),
  label: `#${n} Ticket`,
  metaParts: [],
  tone: 'accent',
  link: `/boucle?ticket=${n}`,
  params: {},
  state: 'open',
  outcome: null,
  createdAt: minutesAgo(n),
  resolvedAt: null,
  ...fields,
});

const BLOCKED = decision(4, { label: '#42 Connexion GitHub', metaParts: ['Code'], tone: 'halt' });
const PERMISSION = decision(2, { kind: 'permission-requested', label: 'Code · #44 Liste des Projets', metaParts: ['session'], tone: 'caution' });
const QUESTION = decision(3, {
  kind: 'agent-question',
  projectId: PERSONAL_OS,
  projectName: 'Personal OS',
  label: 'Concevoir · Agenda partagé',
  metaParts: ['session'],
});
const OFFLINE = decision(5, { kind: 'runner-offline', projectId: null, projectName: null, label: 'WBNT-Maxime', tone: 'halt', createdAt: minutesAgo(60 * 25) });

const ALL = [BLOCKED, PERMISSION, QUESTION, OFFLINE];
const view = (query: Record<string, string> = {}, decisions: Decision[] = ALL, options: Partial<Parameters<typeof aToiView>[2]> = {}) =>
  aToiView(decisions, query, { runnerOnline: true, now: NOW, ...options });

describe('aToiView', () => {
  it('lists the open Décisions newest first: kind, title, meta with the relative time, the default « Ouvrir »', () => {
    const data = view();
    expect(COMPOSANTS.PageAToi.data.parse(data)).toEqual(data);
    expect(data.total).toBe(4);
    expect(data.decisions.map((row) => row.id)).toEqual([PERMISSION.id, QUESTION.id, BLOCKED.id, OFFLINE.id]);
    expect(data.decisions[2]).toEqual({
      id: BLOCKED.id,
      kind: 'Ticket bloqué',
      title: '#42 Connexion GitHub',
      meta: 'Crewdeck · Code · il y a 4 min',
      context: null,
      tone: 'halt',
      icon: 'block',
      actions: [{ id: 'open', label: t('aToi.open'), primary: false, disabledReason: null }],
    });
    expect(data.decisions.map((row) => [row.kind, row.icon, row.meta])).toEqual([
      ['Permission demandée', 'shield', 'Crewdeck · session · il y a 2 min'],
      ['Question de l’agent', 'info', 'Personal OS · session · il y a 3 min'],
      ['Ticket bloqué', 'block', 'Crewdeck · Code · il y a 4 min'],
      ['Runner hors ligne', 'server', 'hier'],
    ]);
  });

  it('gives a chip « Tous les Projets » then one per Projet of the open Décisions, each with its count', () => {
    expect(view().projects).toEqual([
      { id: null, name: 'Tous les Projets', count: 4, selected: true },
      { id: CREWDECK, name: 'Crewdeck', count: 2, selected: false },
      { id: PERSONAL_OS, name: 'Personal OS', count: 1, selected: false },
    ]);
  });

  it('lists only the chosen Projet’s with ?projet=, the total still counting every one', () => {
    const data = view({ projet: CREWDECK });
    expect(data.total).toBe(4);
    expect(data.decisions.map((row) => row.id)).toEqual([PERMISSION.id, BLOCKED.id]);
    expect(data.projects.filter((chip) => chip.selected).map((chip) => chip.id)).toEqual([CREWDECK]);
  });

  it('lists every one for a Projet with no open Décision', () => {
    const data = view({ projet: '019a6f1e-7c3d-7e4f-9a1b-2c3d4e5f6aff' });
    expect(data.decisions).toHaveLength(4);
    expect(data.projects[0]?.selected).toBe(true);
  });

  it('shows a kind as its module registered it, an action needing the Runner disabled while it is not « en ligne »', () => {
    const views = createDecisionViews();
    views.register('ticket-blocked', {
      title: (d) => `${d.label} (bloqué)`,
      context: (d) => `Étape ${String(d.metaParts[0])}`,
      actions: [
        { id: 'open', label: 'aToi.open', run: () => undefined },
        { id: 'retry', label: 'aToi.noteIdea', primary: true, needsRunner: true, run: () => undefined },
      ],
    });
    const [online] = view({}, [BLOCKED], { views }).decisions;
    expect(online).toMatchObject({ title: '#42 Connexion GitHub (bloqué)', context: 'Étape Code' });
    expect(online?.actions.map((action) => [action.id, action.primary, action.disabledReason])).toEqual([
      ['open', false, null],
      ['retry', true, null],
    ]);
    const [offline] = view({}, [BLOCKED], { views, runnerOnline: false }).decisions;
    expect(offline?.actions[1]?.disabledReason).toBe(t('aToi.runnerOffline'));
  });

  it('has nothing to list when no Décision waits, and no « Noter une Idée » yet', () => {
    expect(view({}, [])).toEqual({
      total: 0,
      projects: [{ id: null, name: 'Tous les Projets', count: 0, selected: true }],
      decisions: [],
      canNoteIdea: false,
    });
  });
});
