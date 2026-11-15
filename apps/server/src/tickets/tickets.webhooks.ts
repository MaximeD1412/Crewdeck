import type { RepoRef } from '@crewdeck/contracts';
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { z } from 'zod';
import type { Env } from '../config/env.js';
import { ENV } from '../config/env.module.js';
import { GITHUB_CLIENT, type GitHubClient } from '../github/github.client.js';
import { repoOfUrl, toIssue, toMilestone, toPullRequest, zRawIssue, zRawMilestone, zRawPullRequest } from '../github/github-shapes.js';
import { type GitHubEvent, GitHubEvents } from '../github/webhooks/dispatcher.js';
import type { WebhookPayload } from '../github/webhooks/payload.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ProjectSources, type SourceGroup } from '../projects/project-sources.js';
import { Transactions } from '../realtime/transactions.js';
import { checkStateOf, statusAsCheck } from './checks.js';
import { botLoginOf, codeChangeOfPullRequest, milestoneOfGitHub, ticketOfIssue } from './github-rows.js';
import { TicketActivity } from './ticket-activity.js';
import { TicketsQueue } from './tickets.queue.js';
import { type CheckInput, TicketsWriter, type WriteOrigin } from './tickets.writer.js';

/** The Projet a webhook is about, and its repository. */
export interface WebhookProject {
  readonly id: string;
  readonly repo: RepoRef;
  readonly fullName: string;
}

interface Delivery {
  readonly action: string | undefined;
  readonly payload: WebhookPayload;
  readonly project: WebhookProject;
  readonly origin: WriteOrigin;
}

const zRepositoryId = z.object({ repository: z.object({ id: z.int().positive() }) });
const zNumbered = z.object({ number: z.int().positive(), repository_url: z.string().optional() });
const zCheckRunPayload = z.object({
  check_run: z.object({
    name: z.string().min(1),
    head_sha: z.string(),
    status: z.enum(['queued', 'in_progress', 'completed', 'waiting', 'requested', 'pending']),
    conclusion: z.enum(['success', 'failure', 'neutral', 'cancelled', 'skipped', 'timed_out', 'action_required', 'stale']).nullable().default(null),
    html_url: z.url().nullable().optional(),
    started_at: z.string().nullable().optional(),
    completed_at: z.string().nullable().optional(),
  }),
});
const zStatusPayload = z.object({
  sha: z.string(),
  context: z.string().min(1),
  state: z.enum(['success', 'pending', 'failure', 'error']),
  target_url: z.url().nullable().optional().catch(null),
});
const zCheckSuitePayload = z.object({ check_suite: z.object({ head_sha: z.string() }) });
const zCommentPayload = z.object({
  issue: z.object({ number: z.int().positive(), pull_request: z.unknown().optional() }),
  comment: z.object({ id: z.int().positive(), user: z.object({ login: z.string() }).nullable(), created_at: z.string() }),
});
const zReviewPayload = z.object({
  pull_request: z.object({ number: z.int().positive() }),
  review: z.object({ state: z.string(), user: z.object({ login: z.string() }).nullable(), commit_id: z.string().nullable().optional() }),
});

/** Whether an `issue_comment` is on a PR (its `issue` has a `pull_request`). */
const isPullRequestComment = (payload: WebhookPayload): boolean => {
  const parsed = zCommentPayload.safeParse(payload);
  return parsed.success && parsed.data.issue.pull_request !== undefined;
};

/** The PR actions after which its head may have moved: its checks are read again. */
const HEAD_MOVES = new Set(['opened', 'synchronize', 'reopened']);
const ISSUE_GONE = new Set(['deleted', 'transferred']);

const durationOf = (startedAt: string | null | undefined, completedAt: string | null | undefined): number | null =>
  startedAt && completedAt ? Math.max(0, Date.parse(completedAt) - Date.parse(startedAt)) : null;

/**
 * The GitHub side of the Tickets (BOUCLE-1): each webhook of an issue, a
 * milestone, a PR or a check writes the Projet's rows through the writer,
 * for a group whose Source is GitHub only (`ProjectSources`). Every payload
 * is parsed down to its metadata first (`github-shapes.ts`): a body never
 * reaches a table, an event nor a log line (ADR 0003). Comments and reviews
 * are forwarded on `TicketActivity`, without their text.
 */
@Injectable()
export class TicketsWebhooks implements OnModuleInit {
  private readonly botLogin: string;

  constructor(
    @Inject(ENV) env: Env,
    @Inject(GITHUB_CLIENT) private readonly github: GitHubClient,
    private readonly githubEvents: GitHubEvents,
    private readonly prisma: PrismaService,
    private readonly sources: ProjectSources,
    private readonly transactions: Transactions,
    private readonly writer: TicketsWriter,
    private readonly activity: TicketActivity,
    private readonly queue: TicketsQueue,
  ) {
    this.botLogin = botLoginOf(env.GITHUB_APP_SLUG);
  }

  onModuleInit(): void {
    this.on('issues', 'ticket', (delivery) => this.issue(delivery));
    this.on('sub_issues', 'ticket', (delivery) => this.subIssue(delivery));
    this.on('issue_dependencies', 'ticket', (delivery) => this.dependencies(delivery));
    this.on('milestone', 'ticket', (delivery) => this.milestone(delivery));
    // A PR's comment is of its change of code; an issue's, of its Ticket.
    this.on('issue_comment', (payload) => (isPullRequestComment(payload) ? 'code' : 'ticket'), (delivery) => this.comment(delivery));
    this.on('pull_request', 'code', (delivery) => this.pullRequest(delivery));
    this.on('pull_request_review', 'code', (delivery) => this.review(delivery));
    this.on('check_run', 'code', (delivery) => this.checkRun(delivery));
    this.on('status', 'code', (delivery) => this.status(delivery));
    this.on('check_suite', 'code', (delivery) => this.checkSuite(delivery));
  }

  /** `group` the group whose Source must be GitHub for the event to be handled: fixed, or from its payload. */
  private on(event: string, group: SourceGroup | ((payload: WebhookPayload) => SourceGroup), handle: (delivery: Delivery) => Promise<void>): void {
    this.githubEvents.on(event, async ({ pilotId, action, payload, sourceAt }: GitHubEvent) => {
      const project = await this.projectOf(payload);
      if (!project || !(await this.sources.isGithub(project.id, typeof group === 'function' ? group(payload) : group))) return;
      await this.queue.run(pilotId, () => handle({ action, payload, project, origin: { source: 'github', sourceAt } }));
    });
  }

  private async projectOf(payload: WebhookPayload): Promise<WebhookProject | null> {
    const parsed = zRepositoryId.safeParse(payload);
    if (!parsed.success) return null;
    const row = await this.prisma.scoped.project.findFirst({ where: { githubRepoId: BigInt(parsed.data.repository.id) }, select: { id: true, owner: true, name: true, fullName: true, githubRepoId: true } });
    return row && { id: row.id, repo: { owner: row.owner, name: row.name, id: Number(row.githubRepoId) }, fullName: row.fullName };
  }

  /** Whether an issue of a payload (its `repository_url`) is of the Projet's repository. */
  private inProject(project: WebhookProject, repositoryUrl: string | undefined): boolean {
    if (repositoryUrl === undefined) return true;
    const of = repoOfUrl(repositoryUrl);
    return of !== null && `${of.owner}/${of.name}`.toLowerCase() === project.fullName.toLowerCase();
  }

  private async issue({ action, payload, project, origin }: Delivery): Promise<void> {
    const parsed = z.object({ issue: zRawIssue, milestone: zRawMilestone.nullable().optional() }).safeParse(payload);
    if (!parsed.success || parsed.data.issue.pull_request !== undefined) return;
    const { issue: raw, milestone: removed } = parsed.data;
    await this.transactions.run(async (tx) => {
      if (action !== undefined && ISSUE_GONE.has(action)) {
        await this.writer.removeTicket(tx, project.id, raw.number, origin);
        return;
      }
      const milestone = raw.milestone ?? (action === 'demilestoned' ? removed : null);
      if (milestone) await this.writer.upsertMilestones(tx, project.id, 'github', [milestoneOfGitHub(toMilestone(milestone))], origin);
      const parentNumber = this.parentOf(project, raw.parent_issue_url);
      await this.writer.upsertTickets(tx, project.id, 'github', [ticketOfIssue(toIssue(raw), parentNumber === undefined ? {} : { parentNumber })], origin);
    });
  }

  /** The parent's number from `parent_issue_url`: undefined when GitHub did not say, null without one or in another repository. */
  private parentOf(project: WebhookProject, url: string | null | undefined): number | null | undefined {
    if (url === undefined) return undefined;
    if (url === null) return null;
    const of = repoOfUrl(url);
    return of !== null && this.inProject(project, url) ? of.number : null;
  }

  private async subIssue({ action, payload, project, origin }: Delivery): Promise<void> {
    const parsed = z.object({ sub_issue: zRawIssue, parent_issue: zNumbered }).safeParse(payload);
    if (!parsed.success || !this.inProject(project, parsed.data.sub_issue.repository_url)) return;
    const { sub_issue: sub, parent_issue: parent } = parsed.data;
    const added = action === 'sub_issue_added' || action === 'parent_issue_added';
    const parentNumber = added && this.inProject(project, parent.repository_url) ? parent.number : null;
    await this.transactions.run((tx) => this.writer.upsertTickets(tx, project.id, 'github', [ticketOfIssue(toIssue(sub), { parentNumber })], origin));
  }

  /** A blocked-by added or removed: the blocked issue's native dependencies read again, those of the same repository kept. */
  private async dependencies({ payload, project, origin }: Delivery): Promise<void> {
    const parsed = z.object({ blocked_issue: zNumbered }).safeParse(payload);
    if (!parsed.success || !this.inProject(project, parsed.data.blocked_issue.repository_url)) return;
    const number = parsed.data.blocked_issue.number;
    const blockedBy = await this.blockersOf(project, number);
    const full = zRawIssue.safeParse(payload['blocked_issue']);
    await this.transactions.run(async (tx) => {
      const stored = await tx.ticket.count({ where: { projectId: project.id, number } });
      if (stored === 0 && full.success) await this.writer.upsertTickets(tx, project.id, 'github', [ticketOfIssue(toIssue(full.data), { blockedBy })], origin);
      else await this.writer.setTicketLinks(tx, project.id, [{ number, blockedBy }], origin);
    });
  }

  /** The numbers of the issues of the Projet's repository that `number` is blocked by; another repository's are ignored. */
  async blockersOf(project: WebhookProject, number: number): Promise<number[]> {
    const refs = await this.github.listIssueDependencies(project.repo, number);
    return refs.filter((ref) => `${ref.owner}/${ref.name}`.toLowerCase() === project.fullName.toLowerCase()).map((ref) => ref.number);
  }

  private async milestone({ action, payload, project, origin }: Delivery): Promise<void> {
    const parsed = z.object({ milestone: zRawMilestone }).safeParse(payload);
    if (!parsed.success) return;
    const milestone = toMilestone(parsed.data.milestone);
    await this.transactions.run(async (tx) => {
      if (action === 'deleted') await this.writer.removeMilestone(tx, project.id, milestone.number, origin);
      else await this.writer.upsertMilestones(tx, project.id, 'github', [milestoneOfGitHub(milestone)], origin);
    });
  }

  private async comment({ action, payload, project }: Delivery): Promise<void> {
    const parsed = zCommentPayload.safeParse(payload);
    if (action !== 'created' || !parsed.success) return;
    const { issue, comment } = parsed.data;
    await this.activity.comment({
      projectId: project.id,
      issueNumber: issue.number,
      commentId: comment.id,
      author: comment.user?.login ?? 'ghost',
      isPullRequest: issue.pull_request !== undefined,
      createdAt: new Date(comment.created_at).toISOString(),
    });
  }

  private async pullRequest({ action, payload, project, origin }: Delivery): Promise<void> {
    const parsed = z.object({ pull_request: zRawPullRequest }).safeParse(payload);
    if (!parsed.success) return;
    const pr = toPullRequest(parsed.data.pull_request);
    const checks = action !== undefined && HEAD_MOVES.has(action) ? await this.checksAt(project, pr.headSha) : [];
    await this.transactions.run(async (tx) => {
      await this.writer.upsertCodeChanges(tx, project.id, 'github', [codeChangeOfPullRequest(pr, this.botLogin)], origin);
      if (checks.length > 0) await this.writer.setChecks(tx, project.id, pr.headSha, checks, origin);
    });
  }

  private async review({ action, payload, project }: Delivery): Promise<void> {
    const parsed = zReviewPayload.safeParse(payload);
    if (action !== 'submitted' || !parsed.success) return;
    const { pull_request: pr, review } = parsed.data;
    await this.activity.review({ projectId: project.id, prNumber: pr.number, reviewer: review.user?.login ?? 'ghost', state: review.state, commitId: review.commit_id ?? null });
  }

  private async checkRun({ payload, project, origin }: Delivery): Promise<void> {
    const parsed = zCheckRunPayload.safeParse(payload);
    if (!parsed.success) return;
    const run = parsed.data.check_run;
    const check: CheckInput = { name: run.name, state: checkStateOf(run), durationMs: durationOf(run.started_at, run.completed_at), url: run.html_url ?? null };
    await this.transactions.run((tx) => this.writer.setChecks(tx, project.id, run.head_sha, [check], origin));
  }

  private async status({ payload, project, origin }: Delivery): Promise<void> {
    const parsed = zStatusPayload.safeParse(payload);
    if (!parsed.success) return;
    const { sha, context, state, target_url: url } = parsed.data;
    const check: CheckInput = { name: context, state: checkStateOf(statusAsCheck(state)), url: url ?? null };
    await this.transactions.run((tx) => this.writer.setChecks(tx, project.id, sha, [check], origin));
  }

  /** A check suite requested or completed: the checks of its commit read again, when a change of code has it as its head. */
  private async checkSuite({ payload, project, origin }: Delivery): Promise<void> {
    const parsed = zCheckSuitePayload.safeParse(payload);
    if (!parsed.success) return;
    const sha = parsed.data.check_suite.head_sha;
    if ((await this.prisma.scoped.codeChange.count({ where: { projectId: project.id, headSha: sha } })) === 0) return;
    const checks = await this.checksAt(project, sha);
    await this.transactions.run((tx) => this.writer.setChecks(tx, project.id, sha, checks, origin));
  }

  /** The check runs and the commit statuses of `sha` as checks (their state; a status's context is its name). */
  async checksAt(project: WebhookProject, sha: string): Promise<CheckInput[]> {
    const runs = await this.github.listCheckRuns(project.repo, sha);
    const status = await this.github.getCombinedStatus(project.repo, sha);
    return [
      ...runs.map((run) => ({ name: run.name, state: checkStateOf(run) })),
      ...status.statuses.map((item) => ({ name: item.context, state: checkStateOf(statusAsCheck(item.state)) })),
    ];
  }
}
