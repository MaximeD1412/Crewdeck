import { contratLabel, type Idea, type IdeaAnalysisRun } from '@crewdeck/contracts';
import { formatRelative, t, type ComposantData, type IdeaAnalysis, type MessageKey } from '@crewdeck/sdk';
import type { IdeaAnalysisText } from '../store/idea-plaintext.js';
import { ratingLabel, ratingReason } from './rating.js';

export type IdeaAnalysisData = ComposantData<typeof IdeaAnalysis>;
type Status = IdeaAnalysisData['status'];

/** The Idée as its analysis reads it. */
export type AnalysedIdea = Pick<
  Idea,
  'id' | 'number' | 'state' | 'projectId' | 'targetProjectId' | 'targetIsNew' | 'analysis' | 'impact' | 'effort' | 'duplicateIds' | 'analysisRun'
>;

/**
 * Where an Idée's analysis stands as the page shows it, `null` when its
 * Process has none (no run, no analysis, not `analysing`): its run at work
 * is `running`, or `waiting` while the Runner is not online; its Contrat
 * incomplete or its Session failed is `failed`; otherwise `passed`.
 */
export const analysisStatus = (idea: Pick<AnalysedIdea, 'state' | 'analysis' | 'analysisRun'>, runnerOnline: boolean): Status | null => {
  const run = idea.analysisRun;
  if (run === null && idea.analysis === null && idea.state !== 'analysing') return null;
  if (run?.status === 'incomplete' || run?.status === 'failed') return 'failed';
  if (run?.status === 'running' || (run === null && idea.state === 'analysing')) return runnerOnline ? 'running' : 'waiting';
  return 'passed';
};

/** Whether the last analysis failed: its Contrat incomplete or its Session. */
export const analysisFailed = (idea: Pick<AnalysedIdea, 'analysisRun'>): 'incomplete' | 'failed' | null =>
  idea.analysisRun?.status === 'incomplete' || idea.analysisRun?.status === 'failed' ? idea.analysisRun.status : null;

/** The Projet visé: `new` for « nouveau », the Projet the analysis proposes (else the Pilote's), `null` when there is none yet. */
export const targetOf = (idea: Pick<AnalysedIdea, 'projectId' | 'targetProjectId' | 'targetIsNew'>): string | 'new' | null =>
  idea.targetIsNew ? 'new' : (idea.targetProjectId ?? idea.projectId);

/** The labels of the rules its Contrat did not meet, by `contratLabel`; an id the catalogue does not know as itself. */
const failedRules = (run: IdeaAnalysisRun): string[] =>
  run.failedRuleIds.map((ruleId) =>
    run.contractId !== null && run.contractVersion !== null ? (contratLabel(run.contractId, run.contractVersion, ruleId) ?? ruleId) : ruleId,
  );

/** « Rôle Idée · Claude Code · il y a 4 min ». */
const runLine = (run: IdeaAnalysisRun, roleName: (role: IdeaAnalysisRun['role']) => string, now: Date): string => {
  const when = formatRelative(run.at, now);
  const role = roleName(run.role);
  return run.engine === null
    ? t('idees.analyse.run.noEngine', { role, when })
    : t('idees.analyse.run', { role, engine: t(`engine.${run.engine}` as MessageKey), when });
};

export interface IdeaAnalysisContext {
  /** Its sentences, as the vault opened them (`IdeaPlaintext.analysis`). */
  readonly analysis: IdeaAnalysisText;
  readonly runnerOnline: boolean;
  /** The Pilote's Projets by name, sorted: the choices of « Changer ». */
  readonly projects: readonly { readonly id: string; readonly name: string }[];
  /** The Idée's title without its analysis open: its text's first line, or what the page can say of it. */
  readonly textTitle: string;
  /** « #58 Imprimer le planning de la semaine » for an Idée of the Pilote's, `null` for one the page does not have. */
  readonly ideaLabel: (id: string) => string | null;
  readonly roleName: (role: IdeaAnalysisRun['role']) => string;
  readonly now: Date;
}

/**
 * The data of `cd-idea-analysis` (IDEE-2), `null` when the Idée has no
 * analysis. On its page (`page`): « Analyse », the impact and the effort
 * with their reasons, the Rôle, the Moteur and when it ran; its duplicates
 * are the page's own Card. Beside the list (`aside`): « Analyse · #63 »,
 * headed by its title, the impact and the effort in a word, each duplicate a
 * link to its page; the run, there, only when it failed (`idees-analyse-echouee.html`).
 */
export const ideaAnalysisData = (idea: AnalysedIdea, where: 'page' | 'aside', context: IdeaAnalysisContext): IdeaAnalysisData | null => {
  const status = analysisStatus(idea, context.runnerOnline);
  if (status === null) return null;
  const run = idea.analysisRun;
  const open = context.analysis.status === 'open' ? context.analysis.content : null;
  const passed = status === 'passed';
  const failed = analysisFailed(idea);
  const target = targetOf(idea);
  const names = new Map(context.projects.map((project) => [project.id, project.name]));
  const rating = (value: number | null, why: string | undefined) =>
    !passed || value === null ? null : where === 'page' && why !== undefined ? ratingReason(value, why) : ratingLabel(value);
  const sentence = (): string | null => {
    if (!passed) return null;
    if (open) return open.summary;
    return context.analysis.status === 'opening' ? t('idees.text.opening') : context.analysis.status === 'unreadable' ? t('idees.text.unreadable') : null;
  };
  return {
    id: idea.id,
    title: where === 'page' ? t('idee.analysis.title') : t('idees.analyse.title', { number: idea.number }),
    label: where === 'page' ? t('idee.analysis.label') : t('idees.analyse.label'),
    heading: where === 'page' ? null : (open?.title ?? context.textTitle),
    status,
    summary: sentence(),
    target:
      !passed || target === null
        ? null
        : {
            label: target === 'new' ? t('idees.analyse.target.new') : (names.get(target) ?? t('projets.local.fallbackName')),
            choices: [
              ...context.projects.map((project) => ({ projectId: project.id, label: project.name, selected: project.id === target })),
              { projectId: null, label: t('idees.analyse.target.new'), selected: target === 'new' },
            ],
          },
    impact: rating(idea.impact, open?.impactWhy),
    effort: rating(idea.effort, open?.effortWhy),
    duplicates:
      !passed || where === 'page'
        ? []
        : idea.duplicateIds.flatMap((id) => {
            const label = context.ideaLabel(id);
            return label === null ? [] : [{ id, label, href: `/idees/${id}` }];
          }),
    failure: failed === null || run === null ? null : { kind: failed, rules: failed === 'incomplete' ? failedRules(run) : [] },
    run: (where === 'aside' && passed) || run === null || status === 'waiting' ? null : runLine(run, context.roleName, context.now),
  };
};
