import type { Idea, IdeaAnalysisContent, IdeaAnalysisRun, IdeaState } from '@crewdeck/contracts';
import { COMPOSANTS, t } from '@crewdeck/sdk';
import type { IdeaAnalysisText, IdeaText } from '../store/idea-plaintext.js';
import { ideasToTriage, ideesAside, ideesQuery, ideesView, type IdeesSlices } from './idees.js';

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
  analysisRun: null,
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
    ].map(([id, displayName]) => [id as string, { id: id as string, displayName: displayName as string, nameSealed: null }]),
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

  it('names a Local Projet by the page’s name for it, « Projet local » without one', () => {
    const LOCAL = '019a6f1e-7c3d-7e4f-9a1b-2c3d4e5f6a09';
    const given = slices([idea(70, 'to-triage', { projectId: LOCAL, createdAt: minutesAgo(5) })]);
    const project = new Map(given.project);
    project.set(LOCAL, { id: LOCAL, displayName: null, nameSealed: { key: 'A'.repeat(80), ciphertext: 'B'.repeat(40) } });
    const withLocal = { ...given, project };

    expect(view({}, withLocal).ideas[0]?.meta).toBe('#70 · Projet local · il y a 5 min');
    const named = ideesView(withLocal, plaintext, { ...ideesQuery({}), now: NOW, projectName: (shown) => shown.displayName ?? 'Recettes' });
    expect(named.projects.map((chip) => chip.label)).toEqual(['Tous les Projets', 'Crewdeck', 'Personal OS', 'Recettes', 'Site mairie', 'Tennis Manager']);
    expect(named.ideas[0]?.meta.split(' · ')[1]).toBe('Recettes');
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
    expect(ideesQuery({})).toEqual({ projectFilter: null, tab: 'a-trier', selectedId: null });
    expect(ideesQuery({ projet: CREWDECK, onglet: 'rejetees' })).toEqual({ projectFilter: CREWDECK, tab: 'rejetees', selectedId: null });
  });

  it('reads the Idée beside the list from ?idee=', () => {
    expect(ideesQuery({ idee: 'x' }).selectedId).toBe('x');
  });
});

const ANALYSED_SEALED = { key: 'a'.repeat(80), ciphertext: 'b'.repeat(40) };
const run = (status: IdeaAnalysisRun['status'], fields: Partial<IdeaAnalysisRun> = {}): IdeaAnalysisRun => ({
  stepRunId: '0193a4f2-7c1e-7a10-8c2c-0000000000aa',
  status,
  role: 'idea',
  engine: 'claude-code',
  at: minutesAgo(4),
  contractId: 'idea-analysis',
  contractVersion: 1,
  failedRuleIds: [],
  ...fields,
});
const CONTENT: IdeaAnalysisContent = {
  title: 'Exporter le planning en PDF pour le client',
  summary: 'Un bouton qui produit le planning de la semaine en PDF, à envoyer au client.',
  projectWhy: 'Le planning est dans Personal OS',
  impactWhy: 'le client le demande à chaque fin de semaine',
  effortWhy: 'le planning existe déjà, seul l’export manque',
  duplicates: [{ id: '0193a4f2-7c1e-7a10-8c2c-000000000058', why: 'Le même planning, imprimé' }],
  questions: [],
};
const ANALYSED = [
  idea(64, 'to-triage', { createdAt: minutesAgo(5), analysisRun: run('incomplete', { failedRuleIds: ['idea-analysis.report.schema', 'idea-analysis.report.figures'] }) }),
  idea(63, 'analysed', {
    projectId: null,
    targetProjectId: PERSONAL_OS,
    analysis: ANALYSED_SEALED,
    impact: 3,
    effort: 1,
    duplicateIds: ['0193a4f2-7c1e-7a10-8c2c-000000000058'],
    analysisRun: run('passed'),
    createdAt: minutesAgo(120),
  }),
  idea(58, 'analysed', { projectId: PERSONAL_OS, createdAt: minutesAgo(9 * 24 * 60) }),
];
const opened = (shown: Idea): IdeaAnalysisText => (shown.analysis === null ? { status: 'none' } : { status: 'open', content: CONTENT });
const online = (given: IdeesSlices, state: 'online' | 'offline' = 'online'): IdeesSlices => ({ ...given, runner: { state } as IdeesSlices['runner'] });
const TEXTS_58 = (shown: Idea): IdeaText => (shown.number === 58 ? { status: 'open', text: 'Imprimer le planning de la semaine' } : plaintext(shown));

describe('ideesView, analysed (IDEE-2)', () => {
  it('titles an analysed row by its analysis, with its summary, impact and effort in a word, and « doublon possible : #58 »', () => {
    const data = ideesView(online(slices(ANALYSED)), plaintext, { ...ideesQuery({}), now: NOW, analysis: opened });
    expect(COMPOSANTS.PageIdees.data.parse(data)).toEqual(data);
    expect(data.ideas[1]).toMatchObject({
      title: CONTENT.title,
      summary: CONTENT.summary,
      impact: 'moyen',
      effort: 'faible',
      duplicates: 'doublon possible : #58',
      failed: false,
    });
    expect(data.ideas[2]).toMatchObject({ summary: null, impact: null, effort: null, duplicates: null });
  });

  it('marks a failed analysis, its Contrat incomplete or its Session failed, with what failed under its title', () => {
    const data = ideesView(online(slices(ANALYSED)), plaintext, { ...ideesQuery({}), now: NOW, analysis: opened });
    expect(data.ideas[0]).toMatchObject({ state: 'a-trier', summary: 'L’analyse a échoué : son Contrat n’est pas rempli.', failed: true });
    const session = ideesView(online(slices([idea(64, 'to-triage', { analysisRun: run('failed') })])), plaintext, { ...ideesQuery({}), now: NOW });
    expect(session.ideas[0]).toMatchObject({ summary: 'L’analyse a échoué : sa Session n’a pas abouti.', failed: true });
  });

  it('says « L’analyse est en cours. » of one at work, « En attente du Runner » while the Runner is not online', () => {
    const working = [idea(64, 'analysing', { analysisRun: run('running') })];
    expect(ideesView(online(slices(working)), plaintext, { ...ideesQuery({}), now: NOW }).ideas[0]?.summary).toBe('L’analyse est en cours.');
    expect(ideesView(online(slices(working), 'offline'), plaintext, { ...ideesQuery({}), now: NOW }).ideas[0]?.summary).toBe('En attente du Runner');
    expect(ideesView(slices(working), plaintext, { ...ideesQuery({}), now: NOW }).ideas[0]?.summary).toBe('En attente du Runner');
  });

  it('selects the Idée of ?idee=', () => {
    const data = ideesView(slices(ANALYSED), plaintext, { ...ideesQuery({ idee: ANALYSED[1]?.id ?? '' }), now: NOW });
    expect(data.ideas.map((row) => row.selected)).toEqual([false, true, false]);
  });
});

describe('ideesAside', () => {
  const aside = (selectedId: string | null, given = online(slices(ANALYSED))) => ideesAside(given, TEXTS_58, selectedId, { now: NOW, analysis: opened });

  it('places « Analyse · #63 » beside the list: its title, summary, Projet visé, impact and effort in a word, each duplicate a link', () => {
    const [node, ...rest] = aside(ANALYSED[1]?.id ?? null);
    expect(rest).toEqual([]);
    expect(node).toMatchObject({ tag: 'cd-idea-analysis', slot: 'aside' });
    const data = COMPOSANTS.IdeaAnalysis.data.parse(node?.data);
    expect(data).toMatchObject({
      title: 'Analyse · #63',
      label: 'Idées / Analyse',
      heading: CONTENT.title,
      status: 'passed',
      summary: CONTENT.summary,
      impact: 'moyen',
      effort: 'faible',
      failure: null,
      run: null,
      duplicates: [{ id: '0193a4f2-7c1e-7a10-8c2c-000000000058', label: '#58 Imprimer le planning de la semaine', href: '/idees/0193a4f2-7c1e-7a10-8c2c-000000000058' }],
    });
    expect(data.target).toEqual({
      label: 'Personal OS',
      choices: [
        { projectId: CREWDECK, label: 'Crewdeck', selected: false },
        { projectId: PERSONAL_OS, label: 'Personal OS', selected: true },
        { projectId: SITE_MAIRIE, label: 'Site mairie', selected: false },
        { projectId: '019a6f1e-7c3d-7e4f-9a1b-2c3d4e5f6a04', label: 'Tennis Manager', selected: false },
        { projectId: null, label: 'nouveau', selected: false },
      ],
    });
  });

  it('beside a failed analysis, lists the labels of the rules not met and its run', () => {
    const data = COMPOSANTS.IdeaAnalysis.data.parse(aside(ANALYSED[0]?.id ?? null)[0]?.data);
    expect(data).toMatchObject({
      title: 'Analyse · #64',
      heading: 'Prévenir quand une Planification démarre la Boucle',
      status: 'failed',
      summary: null,
      target: null,
      failure: {
        kind: 'incomplete',
        rules: ['Le rapport a un titre et un résumé d’au plus 400 caractères', 'L’impact et l’effort vont de 1 à 5, chacun avec sa raison'],
      },
      run: 'Rôle Idée · Claude Code · il y a 4 min',
    });
  });

  it('places nothing without ?idee=, for an Idée the page does not have, or one without an analysis', () => {
    expect(aside(null)).toEqual([]);
    expect(aside('0193a4f2-7c1e-7a10-8c2c-0000000000ff')).toEqual([]);
    expect(aside(ANALYSED[2]?.id ?? null)).toEqual([]);
  });
});
