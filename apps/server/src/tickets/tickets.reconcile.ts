import type { CodeChangeState, Issue, PullRequest } from '@crewdeck/contracts';
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import type { Env } from '../config/env.js';
import { ENV } from '../config/env.module.js';
import { GITHUB_CLIENT, type GitHubClient } from '../github/github.client.js';
import { ReconcileHooks } from '../github/reconciliation/reconciliation.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ProjectSources } from '../projects/project-sources.js';
import { Transactions } from '../realtime/transactions.js';
import { botLoginOf, codeChangeOfPullRequest, milestoneOfGitHub, ticketOfIssue } from './github-rows.js';
import { TicketsQueue } from './tickets.queue.js';
import { type WebhookProject, TicketsWebhooks } from './tickets.webhooks.js';
import { type CheckInput, TicketsWriter } from './tickets.writer.js';

const LIVE: readonly CodeChangeState[] = ['open', 'draft'];

/** The parent of an issue as a number of the Projet: none without one, or in another repository. */
const parentNumberIn = (project: WebhookProject, issue: Issue): number | null =>
  issue.parent && `${issue.parent.owner}/${issue.parent.name}`.toLowerCase() === project.fullName.toLowerCase() ? issue.parent.number : null;

/** Every page of a GitHub list. */
const allPages = async <T>(page: (cursor: string | undefined) => Promise<{ items: T[]; nextCursor: string | null }>): Promise<T[]> => {
  const items: T[] = [];
  let cursor: string | undefined;
  do {
    const next = await page(cursor);
    items.push(...next.items);
    cursor = next.nextCursor ?? undefined;
  } while (cursor !== undefined);
  return items;
};

/**
 * The reconciliation of the Tickets (risk OPS-4): what a lost webhook left
 * behind, repaired from GitHub. For each Projet of the installation, by
 * group on GitHub: the open issues and those updated since the last run (all
 * of them the first time) with their parent, each open one's native blocked-by, the
 * milestones; the open PRs, those stored open that GitHub no longer lists
 * (merged or closed meanwhile), and the checks of each one's head. Read
 * first, then written in one transaction per Projet, behind the webhooks of
 * the same Pilote.
 *
 * An issue deleted while its webhook was lost stays: GitHub lists no deleted
 * issue.
 */
@Injectable()
export class TicketsReconcile implements OnModuleInit {
  private readonly botLogin: string;
  /** When the last run of each Projet started: the next one reads the issues updated since. */
  private readonly lastRun = new Map<string, string>();

  constructor(
    @Inject(ENV) env: Env,
    @Inject(GITHUB_CLIENT) private readonly github: GitHubClient,
    private readonly hooks: ReconcileHooks,
    private readonly prisma: PrismaService,
    private readonly sources: ProjectSources,
    private readonly transactions: Transactions,
    private readonly writer: TicketsWriter,
    private readonly webhooks: TicketsWebhooks,
    private readonly queue: TicketsQueue,
  ) {
    this.botLogin = botLoginOf(env.GITHUB_APP_SLUG);
  }

  onModuleInit(): void {
    this.hooks.register({ key: 'tickets', reconcile: ({ pilotId, installationId }) => this.reconcile(pilotId, installationId) });
  }

  /** Every Projet of the installation, one after the other; one that fails does not stop the others, its error rethrown at the end. */
  async reconcile(pilotId: string, installationId: number): Promise<void> {
    const projects = await this.queue.run(pilotId, () => this.projectsOf(installationId));
    let failure: unknown;
    for (const project of projects) {
      try {
        await this.queue.run(pilotId, () => this.reconcileProject(project));
      } catch (error) {
        failure ??= error;
      }
    }
    if (failure !== undefined) throw failure;
  }

  private async projectsOf(installationId: number): Promise<WebhookProject[]> {
    const repositories = await this.prisma.scoped.repository.findMany({ where: { installationId: BigInt(installationId) }, select: { id: true } });
    const rows = await this.prisma.scoped.project.findMany({
      where: { repositoryId: { in: repositories.map((repository) => repository.id) }, accessLost: false },
      select: { id: true, owner: true, name: true, fullName: true, githubRepoId: true },
      orderBy: { followedAt: 'asc' },
    });
    return rows.map((row) => ({ id: row.id, repo: { owner: row.owner, name: row.name, id: Number(row.githubRepoId) }, fullName: row.fullName }));
  }

  private async reconcileProject(project: WebhookProject): Promise<void> {
    const startedAt = new Date().toISOString();
    const tickets = (await this.sources.isGithub(project.id, 'ticket')) ? await this.readTickets(project) : null;
    const code = (await this.sources.isGithub(project.id, 'code')) ? await this.readCode(project) : null;
    await this.transactions.run(async (tx) => {
      if (tickets) {
        await this.writer.upsertMilestones(tx, project.id, 'github', tickets.milestones.map(milestoneOfGitHub));
        const kept = new Set(tickets.milestones.map((milestone) => milestone.number));
        const stored = await tx.milestone.findMany({ where: { projectId: project.id, source: 'github' }, select: { number: true } });
        for (const { number } of stored.filter((row) => !kept.has(row.number))) await this.writer.removeMilestone(tx, project.id, number);
        await this.writer.upsertTickets(
          tx,
          project.id,
          'github',
          tickets.issues.map((issue) => ticketOfIssue(issue, { parentNumber: parentNumberIn(project, issue), ...(tickets.blockedBy.has(issue.number) ? { blockedBy: tickets.blockedBy.get(issue.number) } : {}) })),
        );
      }
      if (code) {
        await this.writer.upsertCodeChanges(tx, project.id, 'github', code.pullRequests.map((pr) => codeChangeOfPullRequest(pr, this.botLogin)));
        for (const [sha, checks] of code.checks) await this.writer.setChecks(tx, project.id, sha, checks);
      }
    });
    if (tickets) this.lastRun.set(project.id, startedAt);
  }

  private async readTickets(project: WebhookProject) {
    const since = this.lastRun.get(project.id);
    const listed = new Map<number, Issue>();
    const list = (state: 'open' | 'all', after?: string) =>
      allPages((cursor) => this.github.listIssues(project.repo, { state, ...(after ? { since: after } : {}), ...(cursor ? { cursor } : {}) }));
    for (const issue of since === undefined ? await list('all') : [...(await list('open')), ...(await list('all', since))]) listed.set(issue.number, issue);
    const issues = [...listed.values()];
    const blockedBy = new Map<number, number[]>();
    for (const issue of issues.filter((candidate) => candidate.state === 'open')) blockedBy.set(issue.number, await this.webhooks.blockersOf(project, issue.number));
    return { issues, blockedBy, milestones: await this.github.listMilestones(project.repo) };
  }

  private async readCode(project: WebhookProject) {
    const open = await allPages((cursor) => this.github.listPullRequests(project.repo, { state: 'open', ...(cursor ? { cursor } : {}) }));
    const listed = new Set(open.map((pr) => pr.number));
    const stale = await this.prisma.scoped.codeChange.findMany({ where: { projectId: project.id, source: 'github', state: { in: [...LIVE] } }, select: { number: true } });
    const ended: PullRequest[] = [];
    for (const { number } of stale.filter((row) => !listed.has(row.number))) {
      const pr = await this.github.getPullRequest(project.repo, number);
      if (pr) ended.push(pr);
    }
    // An ended one's too: its checks may have finished with it, their webhooks lost, and no later run reads it again.
    const pullRequests = [...open, ...ended];
    const checks = new Map<string, CheckInput[]>();
    for (const pr of pullRequests) if (!checks.has(pr.headSha)) checks.set(pr.headSha, await this.webhooks.checksAt(project, pr.headSha));
    return { pullRequests, checks };
  }
}
