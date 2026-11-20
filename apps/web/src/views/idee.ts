import type { Idea } from '@crewdeck/contracts';
import { formatRelative, t, type ComposantData, type PageIdee } from '@crewdeck/sdk';
import type { IdeaText } from '../store/idea-plaintext.js';
import { analysisStatus, ideaAnalysisData } from './idea-analysis.js';
import {
  analysisContext,
  ideaTitleOf,
  projectOf,
  ROW_STATE,
  TAB_OF,
  textTitleOf,
  type IdeesOptions,
  type IdeesSlices,
} from './idees.js';

export type PageIdeeData = ComposantData<typeof PageIdee>;

/** « par toi · au téléphone, dictée · il y a 2 h ». */
const notedMeta = (idea: Pick<Idea, 'notedFrom' | 'dictated' | 'createdAt'>, now: Date): string => {
  const place = t(`idee.noted.from.${idea.notedFrom}`);
  return t('idee.noted.meta', { from: idea.dictated ? t('idee.noted.dictated', { from: place }) : place, when: formatRelative(idea.createdAt, now) });
};

/** The text noted, whole, or what this page can say of it. */
const notedText = (text: IdeaText): string => (text.status === 'open' ? text.text : textTitleOf(text));

/**
 * « Une Idée »'s data (pure, IDEE-2, `/idees/:id`): titled by its
 * analysis's title (else its text's first line), counted « #63 · Analysée »;
 * the Card « Notée », its whole text and how and when it was noted; its
 * analysis, `ideaAnalysisData` on its page, none when its Process has none;
 * once analysed, a row per possible duplicate the page has, « #58 <title> »,
 * « <Projet> · <its tab, in the singular> · <when> », its badge, a link to its page.
 */
export const ideeView = (
  idea: Idea,
  slices: IdeesSlices,
  plaintext: (idea: Idea) => IdeaText,
  options: Omit<IdeesOptions, 'closed'> = {},
): PageIdeeData => {
  const now = options.now ?? new Date();
  const context = analysisContext(idea, slices, plaintext, { ...options, now });
  const text = plaintext(idea);
  const passed = analysisStatus(idea, context.runnerOnline) === 'passed';
  const names = new Map(context.projects.map((project) => [project.id, project.name]));
  const read = options.analysis ?? (() => ({ status: 'none' }) as const);
  return {
    title: ideaTitleOf(text, context.analysis) || t('idee.title.opening'),
    count: t('idee.count', { number: idea.number, state: t(`ideaRow.state.${ROW_STATE[idea.state]}`) }),
    noted: { text: notedText(text), meta: notedMeta(idea, now) },
    analysis: ideaAnalysisData(idea, 'page', context),
    duplicates: !passed
      ? []
      : idea.duplicateIds.flatMap((id) => {
          const other = slices.idea?.get(id);
          if (!other) return [];
          const project = projectOf(other);
          return [
            {
              id,
              title: `#${other.number} ${ideaTitleOf(plaintext(other), read(other))}`,
              meta: [project === null ? null : (names.get(project) ?? null), t(`idee.duplicate.tab.${TAB_OF[other.state]}`), formatRelative(other.createdAt, now)]
                .filter(Boolean)
                .join(' · '),
              state: ROW_STATE[other.state],
              href: `/idees/${id}`,
            },
          ];
        }),
  };
};
