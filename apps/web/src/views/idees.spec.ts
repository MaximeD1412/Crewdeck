import type { Idea, IdeaState } from '@crewdeck/contracts';
import { COMPOSANTS, t } from '@crewdeck/sdk';
import type { IdeaText } from '../store/idea-plaintext.js';
import { ideasToTriage, ideesQuery, ideesView, type IdeesSlices } from './idees.js';

const NOW = new Date('2026-11-16T10:00:00.000Z');
const minutesAgo = (n: number) => new Date(NOW.getTime() - n * 60_000).toISOString();

const CREWDECK = '019a6f1e-7c3d-7e4f-9a1b-2c3d4e5f6a01';
const PERSONAL_OS = '019a6f1e-7c3d-7e4f-9a1b-2c3d4e5f6a02';
const SITE_MAIRIE = '019a6f1e-7c3d-7e4f-9a1b-2c3d4e5f6a03';
const SEALED = { key: 'k'.repeat(80), ciphertext: 'c'.repeat(40) };

const idea = (number: number, state: IdeaState, fields: Partial<Idea> = {}): Idea => ({
  id: `0193a4f2-7c1e-7a10-8c2c-0000000000${String(number).padStart(2, '0')}`,
  number,
  projectId: CREWDECK,
  targetProjectId: null,
  targetIsNew: false,
  state,
  text: SEALED,
  analysis: null,
  impact: null,
  effort: null,
  duplicateIds: [],
  notedFrom: 'pc',
  dictated: false,
  mergedIntoId: null,
  reason: null,
  ticketNumber: null,
  createdAt: minutesAgo(100 - number),
  updatedAt: minutesAgo(100 - number),
  analysedAt: null,
  triagedAt: null,
  ...fields,
});

const TEXTS = new Map<number, string>([
  [64, 'Prévenir quand une Planification démarre la Boucle\nAvec une notification'],
  [63, 'Exporter le planning en PDF pour le client'],
  [62, 'Corriger la date des actualités sur le téléphone'],
  [61, 'Chercher dans les recettes par ingrédient'],
]);
const plaintext = (shown: Idea): IdeaText => {
  const text = TEXTS.get(shown.number);
  return text === undefined ? { status: 'open', text: `Idée ${shown.number}` } : { status: 'open', text };
};

const IDEAS = [
  idea(61, 'analysed', { projectId: PERSONAL_OS, createdAt: minutesAgo(3 * 24 * 60) }),
  idea(64, 'analysing', { createdAt: minutesAgo(5) }),
  idea(62, 'to-triage', { projectId: null, targetProjectId: SITE_MAIRIE, createdAt: minutesAgo(26 * 60) }),
  idea(63, 'analysed', { projectId: PERSONAL_OS, createdAt: minutesAgo(120) }),
  idea(50, 'retained'),
  idea(51, 'retained', { projectId: PERSONAL_OS }),
  idea(52, 'merged'),
  idea(53, 'rejected', { projectId: null }),
];

const slices = (ideas: readonly Idea[] = IDEAS): IdeesSlices => ({
  idea: new Map(ideas.map((shown) => [shown.id, shown])),
  project: new Map(
    [
      [CREWDECK, 'Crewdeck'],
      [SITE_MAIRIE, 'Site mairie'],
      [PERSONAL_OS, 'Personal OS'],
      ['019a6f1e-7c3d-7e4f-9a1b-2c3d4e5f6a04', 'Tennis Manager'],
    ].map(([id, displayName]) => [id as string, { id: id as string, displayName: displayName as string }]),
  ),
});

const view = (query: Record<string, string> = {}, given = slices(), text = plaintext) => ideesView(given, text, { ...ideesQuery(query), now: NOW });

describe('ideesView', () => {
  it('lists the Idées to triage newest first, titled by their first line, with « #<n> · <Projet> · <relative time> »', () => {
    const data = view();
    expect(COMPOSANTS.PageIdees.data.parse(data)).toEqual(data);
    expect(data.ideas.map((row) => [row.title, row.meta, row.state])).toEqual([
      ['Prévenir quand une Planification démarre la Boucle', '#64 · Crewdeck · il y a 5 min', 'en-analyse'],
      ['Exporter le planning en PDF pour le client', '#63 · Personal OS · il y a 2 h', 'analysee'],
      ['Corriger la date des actualités sur le téléphone', '#62 · Site mairie · hier', 'a-trier'],
      ['Chercher dans les recettes par ingrédient', '#61 · Personal OS · 13 nov.', 'analysee'],
    ]);
  });

  it('counts the Idées to triage in the header, whatever the filter', () => {
    expect(view().toTriage).toBe(4);
    expect(view({ projet: PERSONAL_OS, onglet: 'retenues' }).toTriage).toBe(4);
    expect(ideasToTriage(IDEAS)).toBe(4);
  });

  it('gives the four tabs their counts, for the Projet chosen', () => {
    expect(view().tabs.map((tab) => [tab.id, tab.label, tab.count, tab.selected])).toEqual([
      ['a-trier', 'À trier', 4, true],
      ['retenues', 'Retenues', 2, false],
      ['fusionnees', 'Fusionnées', 1, false],
      ['rejetees', 'Rejetées', 1, false],
    ]);
    expect(view({ projet: PERSONAL_OS }).tabs.map((tab) => tab.count)).toEqual([2, 1, 0, 0]);
  });

  it('shows a tab’s Idées with ?onglet=, each with its state', () => {
    expect(view({ onglet: 'retenues' }).ideas.map((row) => [row.meta.split(' · ')[0], row.state])).toEqual([
      ['#51', 'retenue'],
      ['#50', 'retenue'],
    ]);
    expect(view({ onglet: 'fusionnees' }).ideas.map((row) => row.state)).toEqual(['fusionnee']);
    expect(view({ onglet: 'rejetees' }).ideas.map((row) => row.meta)).toEqual(['#53 · il y a 47 min']);
    expect(view({ onglet: 'nope' }).tabs.find((tab) => tab.selected)?.id).toBe('a-trier');
  });

  it('gives a chip per Projet by name, « Tous les Projets » first, each counting the tab’s Idées, none at 0', () => {
    expect(view().projects).toEqual([
      { projectId: null, label: 'Tous les Projets', count: 4, selected: true },
      { projectId: CREWDECK, label: 'Crewdeck', count: 1, selected: false },
      { projectId: PERSONAL_OS, label: 'Personal OS', count: 2, selected: false },
      { projectId: SITE_MAIRIE, label: 'Site mairie', count: 1, selected: false },
      { projectId: '019a6f1e-7c3d-7e4f-9a1b-2c3d4e5f6a04', label: 'Tennis Manager', selected: false },
    ]);
    expect(view({ onglet: 'retenues' }).projects.map((chip) => chip.count)).toEqual([2, 1, 1, undefined, undefined]);
  });

  it('filters by the Projet of ?projet=, the one the analysis proposes when the Pilote chose none', () => {
    const personal = view({ projet: PERSONAL_OS });
    expect(personal.ideas.map((row) => row.meta.split(' · ')[0])).toEqual(['#63', '#61']);
    expect(personal.projects.find((chip) => chip.selected)?.label).toBe('Personal OS');
    expect(view({ projet: SITE_MAIRIE }).ideas.map((row) => row.meta.split(' · ')[0])).toEqual(['#62']);
  });

  it('takes a ?projet= the Pilote does not have for no filter', () => {
    const data = view({ projet: '019a6f1e-7c3d-7e4f-9a1b-2c3d4e5f6aff' });
    expect(data.projects[0]?.selected).toBe(true);
    expect(data.ideas).toHaveLength(4);
  });

  it('says « Déchiffrement… » while a text opens and « Illisible sur cet Appareil » when it cannot', () => {
    const opening = view({}, slices(), () => ({ status: 'opening' }));
    expect(opening.ideas.map((row) => row.title)).toEqual(Array(4).fill(t('idees.text.opening')));
    expect(t('idees.text.opening')).toBe('Déchiffrement…');
    const unreadable = view({}, slices(), () => ({ status: 'unreadable' }));
    expect(unreadable.ideas[0]?.title).toBe('Illisible sur cet Appareil');
  });

  it('is empty without any Idée, and an empty tab is not', () => {
    const none = view({}, slices([]));
    expect(none).toMatchObject({ empty: true, toTriage: 0, ideas: [] });
    expect(none.projects[0]).toEqual({ projectId: null, label: 'Tous les Projets', selected: true });
    expect(COMPOSANTS.PageIdees.data.parse(none)).toEqual(none);
    expect(view({}, slices([idea(50, 'retained')]))).toMatchObject({ empty: false, toTriage: 0, ideas: [] });
  });

  it('joins the Idées merged or rejected older than the slice, the slice’s copy winning, « Afficher les plus anciennes » on their tabs', () => {
    const old = [idea(40, 'merged', { createdAt: minutesAgo(120 * 24 * 60) }), idea(41, 'rejected'), idea(52, 'merged', { projectId: PERSONAL_OS })];
    const closed = { ideas: old, known: true, older: 'available' as const };
    const at = (query: Record<string, string>) => ideesView(slices(), plaintext, { ...ideesQuery(query), now: NOW, closed });
    const merged = at({ onglet: 'fusionnees' });
    expect(COMPOSANTS.PageIdees.data.parse(merged)).toEqual(merged);
    expect(merged.ideas.map((row) => row.meta)).toEqual(['#52 · Crewdeck · il y a 48 min', '#40 · Crewdeck · 19 juil.']);
    expect(merged.tabs.map((tab) => tab.count)).toEqual([4, 2, 2, 2]);
    expect(merged.older).toBe('available');
    expect(at({ onglet: 'rejetees' }).older).toBe('available');
    expect(at({}).older).toBe('none');
    expect(at({ onglet: 'retenues' }).older).toBe('none');
    expect(view({ onglet: 'fusionnees' }).older).toBe('none');
  });

  it('with only Idées older than the slice, is not empty: they are on their tab', () => {
    const only = (closed: { ideas: Idea[]; known: boolean; older: 'none' | 'available' | 'loading' }, query: Record<string, string> = {}) =>
      ideesView(slices([]), plaintext, { ...ideesQuery(query), now: NOW, closed });
    expect(only({ ideas: [], known: false, older: 'loading' })).toMatchObject({ empty: false, ideas: [] });
    expect(only({ ideas: [], known: true, older: 'none' })).toMatchObject({ empty: true });
    const old = only({ ideas: [idea(40, 'merged', { createdAt: minutesAgo(120 * 24 * 60) })], known: true, older: 'none' }, { onglet: 'fusionnees' });
    expect(old).toMatchObject({ empty: false, toTriage: 0 });
    expect(old.ideas.map((row) => row.title)).toEqual(['Idée 40']);
  });
});

describe('ideesQuery', () => {
  it('reads ?projet= and ?onglet=, « À trier » by default', () => {
    expect(ideesQuery({})).toEqual({ projectFilter: null, tab: 'a-trier' });
    expect(ideesQuery({ projet: CREWDECK, onglet: 'rejetees' })).toEqual({ projectFilter: CREWDECK, tab: 'rejetees' });
  });
});
