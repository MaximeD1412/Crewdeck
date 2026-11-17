import { IDEA_TO_TRIAGE_STATES, type Idea, type IdeaState, type Project } from '@crewdeck/contracts';
import { formatRelative, IDEES_TABS, t, type ComposantData, type IdeaRow, type IdeesTab, type PageIdees } from '@crewdeck/sdk';
import type { ClosedIdeasView } from '../closed-ideas.js';
import type { IdeaText } from '../store/idea-plaintext.js';

export type PageIdeesData = ComposantData<typeof PageIdees>;
type IdeaRowData = ComposantData<typeof IdeaRow>;

/** Which tab holds each state: « À trier » the three before the triage. */
const TAB_OF: Readonly<Record<IdeaState, IdeesTab>> = {
  analysing: 'a-trier',
  'to-triage': 'a-trier',
  analysed: 'a-trier',
  retained: 'retenues',
  merged: 'fusionnees',
  rejected: 'rejetees',
};

/** The row's badge (`ideaRow.state.<state>`). */
const ROW_STATE: Readonly<Record<IdeaState, IdeaRowData['state']>> = {
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
const projectOf = (idea: Pick<Idea, 'projectId' | 'targetProjectId'>): string | null => idea.projectId ?? idea.targetProjectId;

/** A row's title: the first line of its text, or what this page can say of it. */
const titleOf = (text: IdeaText): string => {
  if (text.status === 'opening') return t('idees.text.opening');
  if (text.status === 'unreadable') return t('idees.text.unreadable');
  return text.text.split('\n', 1)[0]?.trim() ?? '';
};

export interface IdeesQuery {
  /** `?projet=`: a Projet of the Pilote's, else every one. */
  readonly projectFilter: string | null;
  /** `?onglet=`: one of the tabs, « À trier » by default. */
  readonly tab: IdeesTab;
}

/** What the URL's `?projet=` and `?onglet=` ask, as `ideesView` takes it. */
export const ideesQuery = (query: Readonly<Record<string, string>>): IdeesQuery => {
  const tab = query['onglet'];
  return { projectFilter: query['projet'] ?? null, tab: (IDEES_TABS as readonly string[]).includes(tab ?? '') ? (tab as IdeesTab) : 'a-trier' };
};

/** No Idée beyond the slice: what a view without `closed` takes. */
const NO_CLOSED: ClosedIdeasView = { ideas: [], known: true, older: 'none' };

export interface IdeesSlices {
  readonly idea?: ReadonlyMap<string, Idea>;
  readonly project?: ReadonlyMap<string, Pick<Project, 'id' | 'displayName' | 'nameSealed'>>;
}

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
 */
export const ideesView = (
  slices: IdeesSlices,
  plaintext: (idea: Idea) => IdeaText,
  {
    projectFilter,
    tab,
    now = new Date(),
    closed = NO_CLOSED,
    projectName = plainProjectName,
  }: IdeesQuery & {
    readonly now?: Date;
    readonly closed?: ClosedIdeasView;
    /** A Projet's name (`projects.ts`, `projectName`, for a Local Projet's sealed one). */
    readonly projectName?: (project: Pick<Project, 'id' | 'displayName' | 'nameSealed'>) => string;
  },
): PageIdeesData => {
  const byId = new Map(closed.ideas.map((idea) => [idea.id, idea]));
  for (const idea of slices.idea?.values() ?? []) byId.set(idea.id, idea);
  const all = [...byId.values()].sort((a, b) => b.number - a.number);
  const projects = [...(slices.project?.values() ?? [])]
    .map((project) => ({ id: project.id, name: projectName(project) }))
    .sort((a, b) => a.name.localeCompare(b.name, 'fr'));
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
      return {
        id: idea.id,
        title: titleOf(plaintext(idea)),
        meta: [`#${idea.number}`, name, formatRelative(idea.createdAt, now)].filter(Boolean).join(' · '),
        state: ROW_STATE[idea.state],
        summary: null,
        impact: null,
        effort: null,
        duplicates: null,
        selected: false,
      };
    }),
  };
};
