import type { CodeChangeState, GitHubMilestone, Issue, MergedBy, PullRequest, TicketStateReason } from '@crewdeck/contracts';
import type { CodeChangeInput, MilestoneInput, TicketInput } from './tickets.writer.js';

/** The login GitHub gives the App's merges and comments: `<slug>[bot]`. */
export const botLoginOf = (appSlug: string | undefined): string => `${appSlug ?? 'crewdeck'}[bot]`;

/** GitHub's reasons in the two the product keeps: a duplicate is not planned; reopened means nothing once closed again. */
const stateReasonOf = (issue: Issue): TicketStateReason | null => {
  if (issue.state !== 'closed') return null;
  if (issue.stateReason === 'completed') return 'completed';
  if (issue.stateReason === 'not_planned' || issue.stateReason === 'duplicate') return 'not_planned';
  return null;
};

/** A GitHub issue as a Ticket; its native links when the caller knows them (undefined keeps the stored ones). */
export const ticketOfIssue = (issue: Issue, links: Pick<TicketInput, 'blockedBy' | 'parentNumber'> = {}): TicketInput => ({
  number: issue.number,
  title: issue.title,
  titleSealed: null,
  state: issue.state,
  stateReason: stateReasonOf(issue),
  closedAt: issue.closedAt,
  labels: issue.labels,
  milestoneNumber: issue.milestone?.number ?? null,
  ...links,
  sourceCreatedAt: issue.createdAt,
  sourceUpdatedAt: issue.updatedAt,
});

/** A GitHub milestone: its `rank` is its number, GitHub's order of creation. */
export const milestoneOfGitHub = (milestone: GitHubMilestone): MilestoneInput => ({
  number: milestone.number,
  rank: milestone.number,
  title: milestone.title,
  titleSealed: null,
  state: milestone.state,
  dueOn: milestone.dueOn,
  openCount: milestone.openIssues,
  closedCount: milestone.closedIssues,
  closedAt: milestone.closedAt,
});

const codeChangeStateOf = (pr: PullRequest): CodeChangeState => {
  if (pr.merged) return 'merged';
  if (pr.state === 'closed') return 'closed';
  return pr.draft ? 'draft' : 'open';
};

/** Who merged: the Boucle when the App did (`botLogin`), the Pilote otherwise; undefined when GitHub did not say (its list of PRs). */
const mergedByOf = (pr: PullRequest, botLogin: string): MergedBy | null | undefined => {
  if (!pr.merged) return null;
  if (pr.mergedBy === null) return undefined;
  return pr.mergedBy === botLogin ? 'loop' : 'pilot';
};

export const codeChangeOfPullRequest = (pr: PullRequest, botLogin: string): CodeChangeInput => ({
  number: pr.number,
  title: pr.title,
  titleSealed: null,
  state: codeChangeStateOf(pr),
  headRef: pr.headRef,
  baseRef: pr.baseRef,
  headSha: pr.headSha,
  mergedAt: pr.merged ? pr.mergedAt : null,
  mergedBy: mergedByOf(pr, botLogin),
  mergeSha: pr.merged ? pr.mergeSha : null,
  sourceCreatedAt: pr.createdAt,
});
