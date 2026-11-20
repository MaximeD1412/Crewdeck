import { IDEA_TO_TRIAGE_STATES, type Idea, type IdeaState, type Project } from '@crewdeck/contracts';
import { formatRelative, IdeaAnalysis, IDEES_TABS, t, type ComposantData, type IdeaRow, type IdeesTab, type PageIdees } from '@crewdeck/sdk';
import type { ClosedIdeasView } from '../closed-ideas.js';
import type { PlacedNode } from '../placed.js';
import type { IdeaAnalysisText, IdeaText } from '../store/idea-plaintext.js';
import type { Slices } from '../store/store.js';
import { analysisFailed, analysisStatus, ideaAnalysisData, type IdeaAnalysisContext } from './idea-analysis.js';
import { ratingLabel } from './rating.js';
import { roleName } from './session.js';

export type PageIdeesData = ComposantData<typeof PageIdees>;
type IdeaRowData = ComposantData<typeof IdeaRow>;

/** Which tab holds each state: « À trier » the three before the triage. */
export const TAB_OF: Readonly<Record<IdeaState, IdeesTab>> = {
  analysing: 'a-trier',
  'to-triage': 'a-trier',
  analysed: 'a-trier',
  retained: 'retenues',
  merged: 'fusionnees',
  rejected: 'rejetees',
};

/** The row's badge (`ideaRow.state.<state>`), and the badge of a duplicate on an Idée's page. */
export const ROW_STATE: Readonly<Record<IdeaState, IdeaRowData['state']>> = {
  analysing: 'en-analyse',
  'to-triage': 'a-trier',
  analysed: 'analysee',
  retained: 'retenue',
  merged: 'fusionnee',
  rejected: 'rejetee',
};

const TO_TRIAGE: ReadonlySet<IdeaState> = new Set(IDEA_TO_TRIAGE_STATES);

/** The Idées to triage (`analysing`, `to-triage`, `analysed`): the header's count and the Cadre's. */
export const ideasToTriage = (ideas: Iterable<Pick<Idea, 'state'>>): number => [...ideas].filter((idea) => TO_TRIAGE.has(idea.state)).length;

/** The Projet an Idée is about: the Pilote's choice, else the one its analysis proposes. */
export const projectOf = (idea: Pick<Idea, 'projectId' | 'targetProjectId'>): string | null => idea.projectId ?? idea.targetProjectId;

/** The first line of an Idée's text, or what this page can say of it. */
export const textTitleOf = (text: IdeaText): string => {
  if (text.status === 'opening') return t('idees.text.opening');
  if (text.status === 'unreadable') return t('idees.text.unreadable');
  return text.text.split('\n', 1)[0]?.trim() ?? '';
};

/** An Idée's title: its analysis's once open (IDEE-2), else its text's first line. */
export const ideaTitleOf = (text: IdeaText, analysis: IdeaAnalysisText): string =>
  analysis.status === 'open' ? analysis.content.title : textTitleOf(text);

/** No analysis read: what a view without `analysis` takes. */
const NO_ANALYSIS = (): IdeaAnalysisText => ({ status: 'none' });

/** What a row says of its analysis under its title: its summary, or where it stands. */
const rowSummary = (idea: Idea, analysis: IdeaAnalysisText, runnerOnline: boolean): string | null => {
  const failed = analysisFailed(idea);
  if (failed !== null) return t(`idees.analyse.row.failed.${failed}`);
  const status = analysisStatus(idea, runnerOnline);
  if (status === 'running') return t('idees.analyse.running');
  if (status === 'waiting') return t('idees.analyse.waiting');
  return analysis.status === 'open' ? analysis.content.summary : null;
};

/** « doublon possible : #58 », the duplicates the page has by their `#<n>`. */
const rowDuplicates = (idea: Idea, numberOf: (id: string) => number | undefined): string | null => {
  const numbers = idea.duplicateIds.flatMap((id) => {
    const number = numberOf(id);
    return number === undefined ? [] : [`#${number}`];
  });
  if (numbers.length === 0) return null;
  return t(numbers.length === 1 ? 'idees.analyse.row.duplicate' : 'idees.analyse.row.duplicates', { numbers: numbers.join(', ') });
};

export interface IdeesQuery {
  /** `?projet=`: a Projet of the Pilote's, else every one. */
  readonly projectFilter: string | null;
  /** `?onglet=`: one of the tabs, « À trier » by default. */
  readonly tab: IdeesTab;
  /** `?idee=`: the Idée whose analysis stands beside the list (from 1280 px), else none. */
  readonly selectedId: string | null;
}

/** What the URL's `?projet=`, `?onglet=` and `?idee=` ask, as `ideesView` takes it. */
export const ideesQuery = (query: Readonly<Record<string, string>>): IdeesQuery => {
  const tab = query['onglet'];
  return {
    projectFilter: query['projet'] ?? null,
    tab: (IDEES_TABS as readonly string[]).includes(tab ?? '') ? (tab as IdeesTab) : 'a-trier',
    selectedId: query['idee'] ?? null,
  };
};

/** No Idée beyond the slice: what a view without `closed` takes. */
const NO_CLOSED: ClosedIdeasView = { ideas: [], known: true, older: 'none' };

export interface IdeesSlices {
  readonly idea?: ReadonlyMap<string, Idea>;
  readonly project?: ReadonlyMap<string, Pick<Project, 'id' | 'displayName' | 'nameSealed'>>;
  /** Not online, an analysis at work waits for it (« En attente du Runner »). */
  readonly runner?: Slices['runner'];
  /** The Pilote's own Rôles, to name the one that analysed. */
  readonly settings?: Slices['settings'];
}

export interface IdeesOptions {
  readonly now?: Date;
  readonly closed?: ClosedIdeasView;
  /** A Projet's name (`projects.ts`, `projectName`, for a Local Projet's sealed one). */
  readonly projectName?: (project: Pick<Project, 'id' | 'displayName' | 'nameSealed'>) => string;
  /** An Idée's analysis in clear (`IdeaPlaintext.analysis`); none read without it. */
  readonly analysis?: (idea: Idea) => IdeaAnalysisText;
}

/** The Pilote's Projets by name, sorted. */
const projectsOf = (slices: IdeesSlices, projectName: NonNullable<IdeesOptions['projectName']>) =>
  [...(slices.project?.values() ?? [])]
    .map((project) => ({ id: project.id, name: projectName(project) }))
    .sort((a, b) => a.name.localeCompare(b.name, 'fr'));

/**
 * What `ideaAnalysisData` reads of the page for `idea`: its sentences, the
 * Runner, the Pilote's Projets, the titles of the Idées it may repeat.
 */
export const analysisContext = (
  idea: Idea,
  slices: IdeesSlices,
  plaintext: (idea: Idea) => IdeaText,
  { now = new Date(), projectName = plainProjectName, analysis = NO_ANALYSIS }: Omit<IdeesOptions, 'closed'>,
): IdeaAnalysisContext => ({
  analysis: analysis(idea),
  runnerOnline: slices.runner?.state === 'online',
  projects: projectsOf(slices, projectName),
  textTitle: textTitleOf(plaintext(idea)),
  ideaLabel: (id) => {
    const other = slices.idea?.get(id);
    return other ? `#${other.number} ${ideaTitleOf(plaintext(other), analysis(other))}` : null;
  },
  roleName: (role) => roleName(role, slices.settings),
  now,
});

/**
 * The Emplacement `aside` of « Idées » (IDEE-2, `idees.html`): the analysis
 * of the Idée of `?idee=`, « Analyse · #63 », when the page has it and it
 * has one; nothing otherwise.
 */
export const ideesAside = (
  slices: IdeesSlices,
  plaintext: (idea: Idea) => IdeaText,
  selectedId: string | null,
  options: Omit<IdeesOptions, 'closed'> = {},
): PlacedNode[] => {
  const idea = selectedId === null ? undefined : slices.idea?.get(selectedId);
  const data = idea ? ideaAnalysisData(idea, 'aside', analysisContext(idea, slices, plaintext, options)) : null;
  return data === null ? [] : [{ tag: IdeaAnalysis.tag, slot: 'aside', id: `idea-analysis-${data.id}`, data }];
};

/** A Projet's name without the vault: its `displayName`, else « Projet local ». */
export const plainProjectName = (project: Pick<Project, 'displayName'>): string => project.displayName ?? t('projets.local.fallbackName');

/**
 * « Idées »'s data (pure, IDEE-1): the Idées of the tab and of the Projet
 * chosen, newest first (by `#<n>`), each titled by the first line of its text
 * in clear (`plaintext`), its meta `#<n> · <Projet> · <relative time>`; the
 * chips « Tous les Projets » then each Projet by name, with the count of the
 * tab's Idées it has (none at 0); the tabs with the count of the Projet's
 * Idées each holds; the header counting every Idée to triage. An Idée's
 * Projet is the one the Pilote chose, else the one its analysis proposes.
 * A filter on a Projet the Pilote does not have is no filter. The Idées
 * merged or rejected older than the slice's 90 days (`closed`) join them, the
 * slice's copy winning; « Fusionnées » and « Rejetées » hold « Afficher les
 * plus anciennes » while some remain, and the page is empty only once their
 * first page says there is none.
 *
 * Analysed (IDEE-2), a row is titled by its analysis's title and shows its
 * summary, its impact and effort in a word, and « doublon possible : #58 »;
 * at work, « L'analyse est en cours. » (« En attente du Runner » while it is
 * not online); failed, what failed, its badge and « Relancer l'analyse »
 * (`failed`). The Idée of `?idee=` is `selected`.
 */
export const ideesView = (
  slices: IdeesSlices,
  plaintext: (idea: Idea) => IdeaText,
  { projectFilter, tab, selectedId = null, now = new Date(), closed = NO_CLOSED, projectName = plainProjectName, analysis = NO_ANALYSIS }: Omit<IdeesQuery, 'selectedId'> &
    Partial<Pick<IdeesQuery, 'selectedId'>> &
    IdeesOptions,
): PageIdeesData => {
  const byId = new Map(closed.ideas.map((idea) => [idea.id, idea]));
  for (const idea of slices.idea?.values() ?? []) byId.set(idea.id, idea);
  const all = [...byId.values()].sort((a, b) => b.number - a.number);
  const projects = projectsOf(slices, projectName);
  const runnerOnline = slices.runner?.state === 'online';
  const names = new Map(projects.map((project) => [project.id, project.name]));
  const selected = projectFilter !== null && names.has(projectFilter) ? projectFilter : null;
  const ofProject = selected === null ? all : all.filter((idea) => projectOf(idea) === selected);
  const ofTab = all.filter((idea) => TAB_OF[idea.state] === tab);
  const listed = ofProject.filter((idea) => TAB_OF[idea.state] === tab);
  const count = (n: number) => (n > 0 ? { count: n } : {});
  return {
    toTriage: ideasToTriage(all),
    empty: all.length === 0 && closed.known,
    older: tab === 'fusionnees' || tab === 'rejetees' ? closed.older : 'none',
    projects: [
      { projectId: null, label: t('aToi.allProjects'), ...count(ofTab.length), selected: selected === null },
      ...projects.map((project) => ({
        projectId: project.id,
        label: project.name,
        ...count(ofTab.filter((idea) => projectOf(idea) === project.id).length),
        selected: project.id === selected,
      })),
    ],
    tabs: IDEES_TABS.map((id) => ({
      id,
      label: t(`idees.tab.${id}`),
      count: ofProject.filter((idea) => TAB_OF[idea.state] === id).length,
      selected: id === tab,
    })),
    ideas: listed.map((idea) => {
      const project = projectOf(idea);
      const name = project === null ? null : (names.get(project) ?? null);
      const opened = analysis(idea);
      const passed = analysisStatus(idea, runnerOnline) === 'passed';
      return {
        id: idea.id,
        title: ideaTitleOf(plaintext(idea), opened),
        meta: [`#${idea.number}`, name, formatRelative(idea.createdAt, now)].filter(Boolean).join(' · '),
        state: ROW_STATE[idea.state],
        summary: rowSummary(idea, opened, runnerOnline),
        impact: passed && idea.impact !== null ? ratingLabel(idea.impact) : null,
        effort: passed && idea.effort !== null ? ratingLabel(idea.effort) : null,
        duplicates: passed ? rowDuplicates(idea, (id) => byId.get(id)?.number) : null,
        selected: idea.id === selectedId,
        failed: analysisFailed(idea) !== null,
      };
    }),
  };
};
