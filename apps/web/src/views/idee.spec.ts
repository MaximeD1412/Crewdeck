import type { Idea, IdeaAnalysisContent, IdeaAnalysisRun, IdeaState } from '@crewdeck/contracts';
import { COMPOSANTS } from '@crewdeck/sdk';
import type { IdeaAnalysisText, IdeaText } from '../store/idea-plaintext.js';
import { ideeView } from './idee.js';
import type { IdeesSlices } from './idees.js';

const NOW = new Date('2026-11-16T10:00:00.000Z');
const minutesAgo = (n: number) => new Date(NOW.getTime() - n * 60_000).toISOString();
const CREWDECK = '019a6f1e-7c3d-7e4f-9a1b-2c3d4e5f6a01';
const PERSONAL_OS = '019a6f1e-7c3d-7e4f-9a1b-2c3d4e5f6a02';
const id = (n: number) => `0193a4f2-7c1e-7a10-8c2c-0000000000${n}`;

const run = (status: IdeaAnalysisRun['status'], fields: Partial<IdeaAnalysisRun> = {}): IdeaAnalysisRun => ({
  stepRunId: '0193a4f2-7c1e-7a10-8c2c-0000000000aa',
  status,
  role: 'idea',
  engine: 'claude-code',
  at: minutesAgo(120),
  contractId: 'idea-analysis',
  contractVersion: 1,
  failedRuleIds: [],
  ...fields,
});

const idea = (number: number, state: IdeaState, fields: Partial<Idea> = {}): Idea => ({
  id: id(number),
  number,
  projectId: null,
  targetProjectId: null,
  targetIsNew: false,
  state,
  text: { key: 'k'.repeat(80), ciphertext: `c${number}`.padEnd(40, 'c') },
  analysis: null,
  impact: null,
  effort: null,
  duplicateIds: [],
  notedFrom: 'pc',
  dictated: false,
  mergedIntoId: null,
  reason: null,
  ticketNumber: null,
  createdAt: minutesAgo(120),
  updatedAt: minutesAgo(120),
  analysedAt: null,
  triagedAt: null,
  analysisRun: null,
  ...fields,
});

const CONTENT: IdeaAnalysisContent = {
  title: 'Exporter le planning en PDF pour le client',
  summary: 'Un bouton dans le planning de Personal OS qui produit la semaine affichée en PDF, prêt à envoyer au client.',
  projectWhy: 'Le planning est dans Personal OS',
  impactWhy: 'le client le demande à chaque fin de semaine',
  effortWhy: 'le planning existe déjà, seul l’export manque',
  duplicates: [{ id: id(58), why: 'Le même planning, imprimé' }],
  questions: [],
};

const ANALYSED = idea(63, 'analysed', {
  targetProjectId: PERSONAL_OS,
  analysis: { key: 'a'.repeat(80), ciphertext: 'b'.repeat(40) },
  impact: 3,
  effort: 2,
  duplicateIds: [id(58), id(99)],
  notedFrom: 'telephone',
  dictated: true,
  analysisRun: run('passed'),
});
const DUPLICATE = idea(58, 'analysed', { projectId: PERSONAL_OS, createdAt: minutesAgo(9 * 24 * 60) });

const TEXTS: Readonly<Record<number, string>> = {
  63: 'Pouvoir exporter le planning en PDF pour l’envoyer au client.',
  58: 'Imprimer le planning de la semaine',
  64: 'Prévenir quand une Planification démarre la Boucle\nAvec une notification',
};
const plaintext = (shown: Idea): IdeaText => ({ status: 'open', text: TEXTS[shown.number] ?? `Idée ${shown.number}` });
const analysis = (shown: Idea): IdeaAnalysisText => (shown.analysis === null ? { status: 'none' } : { status: 'open', content: CONTENT });

const slices = (ideas: readonly Idea[], runner: 'online' | 'offline' = 'online'): IdeesSlices => ({
  idea: new Map(ideas.map((shown) => [shown.id, shown])),
  project: new Map([
    [CREWDECK, { id: CREWDECK, displayName: 'Crewdeck', nameSealed: null }],
    [PERSONAL_OS, { id: PERSONAL_OS, displayName: 'Personal OS', nameSealed: null }],
  ]),
  runner: { state: runner } as IdeesSlices['runner'],
});

const view = (shown: Idea, given = slices([ANALYSED, DUPLICATE])) => ideeView(shown, given, plaintext, { now: NOW, analysis });

describe('ideeView', () => {
  it('titles the page by the analysis, counts « #63 · Analysée », and quotes the text noted, how and when', () => {
    const data = view(ANALYSED);
    expect(COMPOSANTS.PageIdee.data.parse(data)).toEqual(data);
    expect(data.title).toBe(CONTENT.title);
    expect(data.count).toBe('#63 · Analysée');
    expect(data.noted).toEqual({ text: TEXTS[63], meta: 'par toi · au téléphone, dictée · il y a 2 h' });
  });

  it('shows the Card « Analyse »: the summary, the Projet visé to change, the impact and the effort with their reasons, the Rôle and the Moteur', () => {
    expect(view(ANALYSED).analysis).toEqual({
      id: ANALYSED.id,
      title: 'Analyse',
      label: 'Une Idée / Analyse',
      heading: null,
      status: 'passed',
      summary: CONTENT.summary,
      target: {
        label: 'Personal OS',
        choices: [
          { projectId: CREWDECK, label: 'Crewdeck', selected: false },
          { projectId: PERSONAL_OS, label: 'Personal OS', selected: true },
          { projectId: null, label: 'nouveau', selected: false },
        ],
      },
      impact: 'moyen : le client le demande à chaque fin de semaine',
      effort: 'faible : le planning existe déjà, seul l’export manque',
      duplicates: [],
      failure: null,
      run: 'Rôle Idée · Claude Code · il y a 2 h',
    });
  });

  it('a new Projet proposed is « nouveau », checked among the choices', () => {
    const fresh = view({ ...ANALYSED, targetProjectId: null, targetIsNew: true }).analysis?.target;
    expect(fresh?.label).toBe('nouveau');
    expect(fresh?.choices.at(-1)).toEqual({ projectId: null, label: 'nouveau', selected: true });
  });

  it('lists the possible duplicates the page has, each « #58 <title> », its Projet, tab and age, its badge and its page', () => {
    expect(view(ANALYSED).duplicates).toEqual([
      { id: id(58), title: '#58 Imprimer le planning de la semaine', meta: 'Personal OS · à trier · 7 nov.', state: 'analysee', href: `/idees/${id(58)}` },
    ]);
  });

  it.each([
    ['retained', 'retenue'],
    ['merged', 'fusionnée'],
    ['rejected', 'rejetée'],
  ] as const)('says a duplicate %s by its tab in the singular, « %s »', (state, word) => {
    const other = { ...DUPLICATE, state };
    expect(view(ANALYSED, slices([ANALYSED, other])).duplicates[0]?.meta).toBe(`Personal OS · ${word} · 7 nov.`);
  });

  it('failed, says what in the Card, the labels of the rules not met, and no duplicates', () => {
    const failed = idea(64, 'to-triage', {
      projectId: CREWDECK,
      duplicateIds: [id(58)],
      analysisRun: run('incomplete', { at: minutesAgo(4), failedRuleIds: ['idea-analysis.report.schema', 'unknown.rule'] }),
    });
    const data = view(failed, slices([failed, DUPLICATE]));
    expect(data.title).toBe('Prévenir quand une Planification démarre la Boucle');
    expect(data.count).toBe('#64 · À trier');
    expect(data.analysis).toMatchObject({
      status: 'failed',
      summary: null,
      target: null,
      impact: null,
      failure: { kind: 'incomplete', rules: ['Le rapport a un titre et un résumé d’au plus 400 caractères', 'unknown.rule'] },
      run: 'Rôle Idée · Claude Code · il y a 4 min',
    });
    expect(data.duplicates).toEqual([]);
    const session = view({ ...failed, analysisRun: run('failed', { engine: null }) }).analysis;
    expect(session).toMatchObject({ failure: { kind: 'failed', rules: [] }, run: 'Rôle Idée · il y a 2 h' });
  });

  it('at work, is running, or waiting while the Runner is not online (without its run line)', () => {
    const working = idea(64, 'analysing', { analysisRun: run('running', { at: minutesAgo(1) }) });
    expect(view(working, slices([working])).analysis).toMatchObject({ status: 'running', summary: null, run: 'Rôle Idée · Claude Code · il y a 1 min' });
    expect(view(working, slices([working], 'offline')).analysis).toMatchObject({ status: 'waiting', run: null });
    expect(view(working).count).toBe('#64 · En analyse');
  });

  it('without an analysis in its Process, has no Card « Analyse »', () => {
    const bare = idea(65, 'to-triage', { notedFrom: 'pc' });
    const data = view(bare, slices([bare]));
    expect(data.analysis).toBeNull();
    expect(data.noted.meta).toBe('par toi · au PC · il y a 2 h');
    expect(data.title).toBe('Idée 65');
  });

  it('says « Déchiffrement… » while the analysis opens, and the text’s first line titles the page meanwhile', () => {
    const data = ideeView(ANALYSED, slices([ANALYSED]), plaintext, { now: NOW, analysis: () => ({ status: 'opening' }) });
    expect(data.title).toBe(TEXTS[63]);
    expect(data.analysis).toMatchObject({ summary: 'Déchiffrement…', impact: 'moyen', effort: 'faible' });
  });
});
