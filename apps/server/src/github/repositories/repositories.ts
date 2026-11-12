import { type InstallationRepository, REPOSITORIES_MAX, type Repository } from '@crewdeck/contracts';
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { AppError } from '../../errors/app-error.js';
import { newId } from '../../ids.js';
import { PROJECT_VIEW, toProject } from '../../projects/project.view.js';
import { EventsWriter, type WriteOptions } from '../../realtime/events.writer.js';
import { STATE_CONTRIBUTORS, type StateContributor, type StateContributors } from '../../realtime/state-contributors.js';
import { Transactions, type Tx } from '../../realtime/transactions.js';
import { runInPilotScope } from '../../scope/scope.context.js';
import { GITHUB_CLIENT, type GitHubClient } from '../github.client.js';
import { ReconcileHooks } from '../reconciliation/reconciliation.service.js';
import { GitHubEvents } from '../webhooks/dispatcher.js';
import { GitHubInstallations } from '../webhooks/installations.js';
import type { WebhookPayload } from '../webhooks/payload.js';

/** « Has code »: at least this many commits on the default branch (an initial commit alone is a new repository). */
export const HAS_CODE_COMMITS = 2;

/** What of a `repositories` row the page sees, `followed` aside. */
export const REPOSITORY_VIEW = {
  id: true,
  owner: true,
  name: true,
  fullName: true,
  private: true,
  defaultBranch: true,
  hasCode: true,
} as const;

type RepositoryRow = Omit<Repository, 'followed'>;

const toRepository = (row: RepositoryRow, followed: boolean): Repository => ({ ...row, followed });

/** The ids of the rows of `repositories` a Projet follows. */
const followedIds = async (tx: Pick<Tx, 'project'>): Promise<string[]> => (await tx.project.findMany({ select: { repositoryId: true } })).map((row) => row.repositoryId);

/** The Pilote's Dépôts GitHub not followed yet (scoped by `tx`), by name, at most `REPOSITORIES_MAX`. */
export const listUnfollowedRepositories = async (tx: Pick<Tx, 'project' | 'repository'>): Promise<Repository[]> =>
  (
    await tx.repository.findMany({
      where: { id: { notIn: await followedIds(tx) } },
      select: REPOSITORY_VIEW,
      orderBy: [{ name: 'asc' }, { owner: 'asc' }],
      take: REPOSITORIES_MAX,
    })
  ).map((row) => toRepository(row, false));

/** A repository as GitHub gave it, with what the server reads of its default branch. */
interface RepositoryFacts {
  readonly repo: InstallationRepository;
  readonly defaultBranch: string;
  readonly hasCode: boolean;
}

/** Where a change comes from: a webhook (`source: 'github'`, its reception) or the reconciliation. */
interface Origin {
  readonly sourceAt?: Date;
}

const githubIdsAt = (payload: WebhookPayload, key: string): number[] => {
  const list = payload[key];
  if (!Array.isArray(list)) return [];
  return list.flatMap((item: unknown) => {
    const id = typeof item === 'object' && item !== null ? (item as Record<string, unknown>)['id'] : undefined;
    return typeof id === 'number' && Number.isSafeInteger(id) && id > 0 ? [id] : [];
  });
};

/**
 * The Dépôts GitHub (US-3, PROJET-2): the repositories the Pilote's
 * installations of the App reach (ADR 0002), kept in step by the webhooks
 * (`installation.created`, `installation_repositories.added` and `.removed`,
 * `installation.deleted`) and the reconciliation's `repositories` hook. Of a
 * repository it reads its metadata, its default branch and how many commits
 * that branch has, never a file. A repository the installation no longer
 * reaches is deleted (`repository.removed`) and its Projet marked
 * `accessLost`; back, it takes the Projet's `repositoryId` again. An
 * installation GitHub no longer has (its `installation.deleted` lost) is
 * removed as that webhook would have.
 *
 * A Pilote's changes run one after the other, GitHub's reads included: a
 * removal never lands between a sync's read and its write, to be undone by
 * what the sync read before it.
 */
@Injectable()
export class Repositories implements OnModuleInit {
  constructor(
    @Inject(GITHUB_CLIENT) private readonly github: GitHubClient,
    private readonly githubEvents: GitHubEvents,
    private readonly hooks: ReconcileHooks,
    private readonly transactions: Transactions,
    private readonly events: EventsWriter,
    private readonly installations: GitHubInstallations,
  ) {}

  /** The last change queued per Pilote. */
  private readonly queues = new Map<string, Promise<unknown>>();

  onModuleInit(): void {
    this.githubEvents.on('installation', async ({ pilotId, installationId, action, sourceAt }) => {
      if (pilotId === null) return;
      if (action === 'created') await this.sync(pilotId, installationId, { prune: true, sourceAt });
      else if (action === 'deleted') await this.removeInstallation(pilotId, installationId, { sourceAt });
    });
    this.githubEvents.on('installation_repositories', async ({ pilotId, installationId, action, payload, sourceAt }) => {
      if (action === 'added') await this.sync(pilotId, installationId, { only: new Set(githubIdsAt(payload, 'repositories_added')), prune: false, sourceAt });
      else if (action === 'removed') await this.remove(pilotId, githubIdsAt(payload, 'repositories_removed'), { sourceAt });
    });
    this.hooks.register({ key: 'repositories', reconcile: ({ pilotId, installationId }) => this.sync(pilotId, installationId, { prune: true }) });
  }

  /**
   * Reads the installation's repositories from GitHub (`only` those, when
   * given), then writes what changed in one transaction; with `prune`, the
   * rows of this installation GitHub no longer lists are removed. The
   * commits are counted each time: a force push can take them back.
   */
  sync(pilotId: string, installationId: number, options: Origin & { readonly only?: ReadonlySet<number>; readonly prune: boolean }): Promise<void> {
    return this.serial(pilotId, () => this.syncNow(pilotId, installationId, options));
  }

  /** `installation_repositories.removed`: the repositories GitHub named. */
  remove(pilotId: string, githubIds: readonly number[], origin: Origin): Promise<void> {
    return this.serial(pilotId, () => this.removeNow(pilotId, githubIds, origin));
  }

  /** `installation.deleted`: every repository of the installation. */
  removeInstallation(pilotId: string, installationId: number, origin: Origin): Promise<void> {
    return this.serial(pilotId, () => this.removeInstallationNow(pilotId, installationId, origin));
  }

  private async syncNow(pilotId: string, installationId: number, options: Origin & { readonly only?: ReadonlySet<number>; readonly prune: boolean }): Promise<void> {
    let listed: InstallationRepository[];
    try {
      listed = await this.github.listInstallationRepositories(installationId);
    } catch (error) {
      if (!(error instanceof AppError && error.code === 'github.installation-gone')) throw error;
      await this.removeInstallationNow(pilotId, installationId, options);
      await this.installations.deleted(installationId);
      return;
    }
    const wanted = options.only ? listed.filter((repo) => options.only?.has(repo.id)) : listed;
    const facts: RepositoryFacts[] = [];
    for (const repo of wanted) {
      const defaultBranch = await this.github.getDefaultBranch(repo);
      const hasCode = (await this.github.countCommits(repo, defaultBranch, HAS_CODE_COMMITS)) >= HAS_CODE_COMMITS;
      facts.push({ repo, defaultBranch, hasCode });
    }
    await this.transactions.run(async (tx) => {
      for (const fact of facts) await this.upsert(tx, pilotId, installationId, fact, options);
      if (!options.prune) return;
      const gone = await tx.repository.findMany({
        where: { installationId: BigInt(installationId), githubId: { notIn: listed.map((repo) => BigInt(repo.id)) } },
        select: { id: true },
      });
      await this.removeRows(tx, pilotId, gone, options);
    });
  }

  private async removeNow(pilotId: string, githubIds: readonly number[], origin: Origin): Promise<void> {
    if (githubIds.length === 0) return;
    await this.transactions.run(async (tx) => {
      const rows = await tx.repository.findMany({ where: { githubId: { in: githubIds.map(BigInt) } }, select: { id: true } });
      await this.removeRows(tx, pilotId, rows, origin);
    });
  }

  private async removeInstallationNow(pilotId: string, installationId: number, origin: Origin): Promise<void> {
    await this.transactions.run(async (tx) => {
      const rows = await tx.repository.findMany({ where: { installationId: BigInt(installationId) }, select: { id: true } });
      await this.removeRows(tx, pilotId, rows, origin);
    });
  }

  private async upsert(tx: Tx, pilotId: string, installationId: number, { repo, defaultBranch, hasCode }: RepositoryFacts, origin: Origin): Promise<void> {
    const data = {
      installationId: BigInt(installationId),
      owner: repo.owner,
      name: repo.name,
      fullName: `${repo.owner}/${repo.name}`,
      private: repo.private,
      defaultBranch,
      hasCode,
    };
    const githubId = BigInt(repo.id);
    const row = await tx.repository.findUnique({ where: { pilotId_githubId: { pilotId, githubId } }, select: { ...REPOSITORY_VIEW, installationId: true } });
    if (row && Object.entries(data).every(([key, value]) => row[key as keyof typeof row] === value)) return;
    // A repository back in an installation takes its Projet's `repositoryId` again.
    const project = row
      ? await tx.project.findUnique({ where: { repositoryId: row.id }, select: { ...PROJECT_VIEW } })
      : await tx.project.findUnique({ where: { pilotId_githubRepoId: { pilotId, githubRepoId: githubId } }, select: { ...PROJECT_VIEW } });
    const saved = row
      ? await tx.repository.update({ where: { id: row.id }, data, select: REPOSITORY_VIEW })
      : await tx.repository.create({ data: { id: project?.repositoryId ?? newId(), pilotId, githubId, ...data }, select: REPOSITORY_VIEW });
    const seq = await this.events.write(tx, pilotId, 'repository.upserted', toRepository(saved, project !== null), this.writeOptions(origin));
    await tx.repository.update({ where: { id: saved.id }, data: { lastSeq: seq } });
    if (project?.accessLost) {
      const back = await tx.project.update({ where: { id: project.id }, data: { accessLost: false, owner: data.owner, name: data.name, fullName: data.fullName }, select: PROJECT_VIEW });
      const projectSeq = await this.events.write(tx, pilotId, 'project.upserted', toProject(back), this.writeOptions(origin));
      await tx.project.update({ where: { id: project.id }, data: { lastSeq: projectSeq } });
    }
  }

  private async removeRows(tx: Tx, pilotId: string, rows: readonly { id: string }[], origin: Origin): Promise<void> {
    for (const { id } of rows) {
      await tx.repository.delete({ where: { id } });
      await this.events.write(tx, pilotId, 'repository.removed', { id }, this.writeOptions(origin));
      const project = await tx.project.findUnique({ where: { repositoryId: id }, select: { id: true, accessLost: true } });
      if (!project || project.accessLost) continue;
      const lost = await tx.project.update({ where: { id: project.id }, data: { accessLost: true }, select: PROJECT_VIEW });
      const seq = await this.events.write(tx, pilotId, 'project.upserted', toProject(lost), this.writeOptions(origin));
      await tx.project.update({ where: { id: project.id }, data: { lastSeq: seq } });
    }
  }

  /** Runs `fn` in `pilotId`'s scope, after the Pilote's changes already queued, whether they failed or not. */
  private serial<T>(pilotId: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(pilotId) ?? Promise.resolve();
    const run = previous.then(
      () => runInPilotScope(pilotId, fn),
      () => runInPilotScope(pilotId, fn),
    );
    const settled = run.then(
      () => undefined,
      () => undefined,
    );
    this.queues.set(pilotId, settled);
    void settled.then(() => {
      if (this.queues.get(pilotId) === settled) this.queues.delete(pilotId);
    });
    return run;
  }

  private writeOptions({ sourceAt }: Origin): WriteOptions {
    return sourceAt ? { source: 'github', sourceAt } : {};
  }
}

/** The `repositories` slice of `GET /api/state`: the Dépôts GitHub not followed yet. */
@Injectable()
export class RepositoryState implements StateContributor<'repositories'>, OnModuleInit {
  readonly key = 'repositories';

  constructor(@Inject(STATE_CONTRIBUTORS) private readonly contributors: StateContributors) {}

  onModuleInit(): void {
    this.contributors.add(this);
  }

  snapshot(tx: Tx): Promise<Repository[]> {
    return listUnfollowedRepositories(tx);
  }
}
