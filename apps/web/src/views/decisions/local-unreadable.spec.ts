import { type Decision, localSealedParam, type SealedItem } from '@crewdeck/contracts';
import { COMPOSANTS } from '@crewdeck/sdk';
import { aToiView } from '../a-toi.js';
import { localUnreadableView } from './local-unreadable.js';
import { decisionViews } from './registry.js';

const NOW = new Date('2026-11-19T10:25:00.000Z');
const PROJECT_ID = '019a6f00-0000-7000-8000-0000000000b1';
const KEY = 'AAECAwQFBgcICQoLDA0ODw';
const PATH_SEALED: SealedItem = { key: 'a2V5', ciphertext: 'Y2lwaGVydGV4dA' };

const unreadable = (params: Decision['params']): Decision => ({
  id: '019a6f1e-7c3d-7e4f-9a1b-2c3d4e5f6c21',
  kind: 'ticket.local-unreadable',
  projectId: PROJECT_ID,
  projectName: null,
  subjectType: 'project',
  subjectId: `${PROJECT_ID}:${KEY}`,
  label: 'Fichier de Ticket illisible',
  metaParts: ['front matter illisible'],
  tone: 'caution',
  link: `/projets/${PROJECT_ID}`,
  params,
  state: 'open',
  outcome: null,
  createdAt: '2026-11-19T10:00:00.000Z',
  resolvedAt: null,
});

const row = (item: Decision, localText: (projectId: string, sealed: SealedItem, place: string) => string) => {
  const data = aToiView([item], {}, { runnerOnline: true, now: NOW, projectName: () => 'Recettes', localText });
  expect(COMPOSANTS.PageAToi.data.parse(data)).toEqual(data);
  return data.decisions[0];
};

describe('« Fichier de Ticket illisible » in « À toi »', () => {
  it('names the file from its sealed path, opened under its place, the reason in its meta, « Ouvrir » its Projet', () => {
    const opened: unknown[] = [];
    const localText = (projectId: string, sealed: SealedItem, place: string) => {
      opened.push({ projectId, sealed, place });
      return 'tickets/7-courses.md';
    };

    expect(decisionViews.viewOf('ticket.local-unreadable')).toBe(localUnreadableView);
    expect(row(unreadable({ pathSealed: localSealedParam(PATH_SEALED), reason: 'front-matter' }), localText)).toMatchObject({
      kind: 'Fichier de Ticket illisible',
      title: 'Fichier de Ticket illisible',
      meta: 'Recettes · front matter illisible · il y a 25 min',
      context: 'Fichier tickets/7-courses.md',
      tone: 'caution',
      actions: [{ id: 'open', label: 'Ouvrir', primary: true, disabledReason: null }],
    });
    expect(opened).toEqual([{ projectId: PROJECT_ID, sealed: PATH_SEALED, place: `unreadable:${KEY}:path` }]);
  });

  it('shows « … » for the name until it opened, and no line for params it cannot read', () => {
    expect(row(unreadable({ pathSealed: localSealedParam(PATH_SEALED), reason: 'front-matter' }), () => '…')?.context).toBe('Fichier …');
    expect(row(unreadable({ reason: 'front-matter' }), () => 'x')?.context).toBeNull();
    expect(row({ ...unreadable({ pathSealed: localSealedParam(PATH_SEALED) }), subjectId: PROJECT_ID }, () => 'x')?.context).toBeNull();
  });
});
