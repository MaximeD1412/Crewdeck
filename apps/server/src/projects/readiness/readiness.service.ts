import { isDeepStrictEqual } from 'node:util';
import {
  type Event,
  findGaps,
  PROCESS_LABELS,
  processSourcesOf,
  type Project,
  type ProcessSources,
  type ProjectFolderPrepareError,
  type ProjectFolderPrepared,
  type ProjectFolderStateMessage,
  type ReadinessFixId,
  type RepoRef,
  zProject,
} from '@crewdeck/contracts';
import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { AppError, notFound, unprocessable } from '../../errors/app-error.js';
import { MESSAGES } from '../../errors/messages.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { GITHUB_CLIENT, type GitHubClient } from '../../github/github.client.js';
import { ReconcileHooks } from '../../github/reconciliation/reconciliation.service.js';
import { type GitHubEvent, GitHubEvents } from '../../github/webhooks/dispatcher.js';
import { newId } from '../../ids.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { readProjectProcess } from '../../process/process.service.js';
import { EventsBus } from '../../realtime/events.bus.js';
import { EventsWriter } from '../../realtime/events.writer.js';
import { assertFresh } from '../../realtime/freshness.js';
import { Transactions } from '../../realtime/transactions.js';
import { RunnerCommands } from '../../runners/runner-commands.service.js';
import { RunnerConnections } from '../../runners/runner-connections.js';
import { RunnerDispatcher } from '../../runners/runner-dispatcher.js';
import { RunnerPresence } from '../../runners/runner-presence.service.js';
import { currentPilotId, runInPilotScope } from '../../scope/scope.context.js';
import { RolesService } from '../../settings/roles.js';
import { ProjectChanges } from '../project-changes.js';
import { PROJECT_VIEW, toProject } from '../project.view.js';
import { ProjectFolders } from '../local/project-folders.js';
import { definitionOf, evaluateReadiness, type FolderFigures, type GitHubFigures, type ReadinessFacts, roleIdsOf } from './readiness.checks.js';

/** What a recompute reads again: GitHub (labels, branches), the folder (a `project.folder.status` to the Runner, its answer recomputing). */
export interface RecomputeReads {
  readonly github?: boolean;
  readonly folder?: boolean;
}

/** The names a figure of GitHub or of the folder was read for: read again once the Pilote changed a branch. */
interface BranchNames {
  readonly release: string;
  readonly integration: string;
}

/**
 * What the readiness last read of GitHub and of the folder, stored with it
 * (`projects.readiness_facts`): figures only, never a path nor a content.
 * `preparing` is the `requestId` of the folder's preparation running,
 * `error` the failure of the last one.
 */
export interface ReadinessStoredFacts {
  readonly github: (GitHubFigures & BranchNames) | null;
  readonly folder: (FolderFigures & BranchNames) | null;
  readonly preparing: string | null;
  readonly error: ProjectFolderPrepareError | null;
}

const NO_FACTS: ReadinessStoredFacts = { github: null, folder: null, preparing: null, error: null };

const storedFactsOf = (value: Prisma.JsonValue | null): ReadinessStoredFacts =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? { ...NO_FACTS, ...(value as unknown as Partial<ReadinessStoredFacts>) } : NO_FACTS;

const READ_VIEW = { ...PROJECT_VIEW, githubRepoId: true, readinessFacts: true, lastSeq: true } as const;

const projectNotFound = (): AppError => notFound('project.not-found', MESSAGES['project.not-found']);
const fixUnavailable = (): AppError => unprocessable('project.fix-unavailable', MESSAGES['project.fix-unavailable']);
const runnerOffline = (): AppError => unprocessable('runner.offline', MESSAGES['runner.offline']);

/** The events after which a Projet's readiness is computed again from what it holds, without reading GitHub nor the folder. */
const RECOMPUTED_ON = new Set(['runner', 'ai-account', 'settings', 'mcp-server', 'source-migration']);

/** What of a Projet's view its readiness reads: a `project.upserted` that changes none of them is the readiness's own. */
const inputsOf = (project: Pick<Project, 'releaseBranch' | 'integrationBranch' | 'hasCode' | 'inventoryState' | 'accessLost' | 'folder'>): string =>
  JSON.stringify([project.releaseBranch, project.integrationBranch, project.hasCode, project.inventoryState, project.accessLost, project.folder]);

/** The readiness without its instant: two of them alike change nothing the page sees. */
const sameReadiness = (a: Prisma.JsonValue | null, b: Project['readiness']): boolean => {
  if (a === null || b === null) return a === b;
  const { computedAt: _a, ...left } = a as Record<string, unknown>;
  const { computedAt: _b, ...right } = b;
  // JSONB orders an object's keys its own way: compared as values.
  return isDeepStrictEqual(left, JSON.parse(JSON.stringify(right)));
};

/**
 * The readiness of the Projets (US-4, PROJET-3): what each still misses to
 * run its Process, stored in `projects.readiness` with `project.upserted`
 * and computed on its triggers only (pages read the store, ADR 0008).
 * GitHub is read on following, after a GitHub fix, on a `push` to one of
 * its branches, a `label` webhook and the reconciliation; the folder on the
 * Runner's `hello.accepted`, a change of `projects.folders` and after its
 * fix; the rest (the Runner, the Comptes IA, the Rôles, the Process, the
 * Serveurs MCP, the Sources, the Inventaire) on their events, from what was
 * read last. One computation after the other per Pilote; a write only when
 * the readiness changed.
 */
@Injectable()
export class ReadinessService implements OnModuleInit, OnModuleDestroy {
  private readonly queues = new Map<string, Promise<void>>();
  /** Per Projet, `inputsOf` its view at its last computation. */
  private readonly inputs = new Map<string, string>();
  private readonly removals: (() => void)[] = [];

  constructor(
    private readonly prisma: PrismaService,
    private readonly transactions: Transactions,
    private readonly events: EventsWriter,
    private readonly bus: EventsBus,
    private readonly roles: RolesService,
    private readonly commands: RunnerCommands,
    private readonly presence: RunnerPresence,
    private readonly connections: RunnerConnections,
    private readonly dispatcher: RunnerDispatcher,
    private readonly githubEvents: GitHubEvents,
    private readonly hooks: ReconcileHooks,
    private readonly changes: ProjectChanges,
    private readonly folders: ProjectFolders,
    @Inject(GITHUB_CLIENT) private readonly github: GitHubClient,
    @InjectPinoLogger(ReadinessService.name) private readonly logger: PinoLogger,
  ) {}

  onModuleInit(): void {
    this.removals.push(
      this.changes.onChanged((pilotId) => this.later(pilotId, null, { github: true })),
      this.folders.onFolderChanged((pilotId, projectId) => this.later(pilotId, projectId, { folder: true })),
      this.connections.onAccepted((link) => this.later(link.pilotId, null, { folder: true })),
      this.bus.subscribeAll((pilotId, event) => this.published(pilotId, event)),
    );
    this.githubEvents.on('push', (event) => this.pushed(event));
    this.githubEvents.on('label', (event) => this.labelled(event));
    this.hooks.register({ key: 'readiness', reconcile: ({ pilotId }) => this.enqueue(pilotId, () => this.recomputeAll({ github: true })) });
    this.dispatcher.registerRunnerHandler('project.folder.state', (message, context) => this.enqueue(context.pilotId, () => this.folderState(message)));
    this.dispatcher.registerRunnerHandler('project.folder.prepared', (message, context) => this.enqueue(context.pilotId, () => this.folderPrepared(message)));
  }

  onModuleDestroy(): void {
    for (const remove of this.removals.splice(0)) remove();
  }

  /** Computes the Projet's readiness again, reading what `reads` names; resolves once written (or found unchanged). */
  recompute(pilotId: string, projectId: string, reads: RecomputeReads = {}): Promise<void> {
    return this.enqueue(pilotId, () => this.compute(pilotId, projectId, reads));
  }

  /** Resolves once no computation is queued, of any Pilote: what a test awaits after a trigger. */
  async settled(): Promise<void> {
    while (this.queues.size > 0) await Promise.all(this.queues.values());
  }

  /**
   * `POST /api/projects/:id/fixes/:checkId`: the check's own fix, then its
   * readiness again; the Projet. 404 `project.not-found`, 409
   * `realtime.stale`, 422 `project.fix-unavailable` (the check absent, `ok`
   * or without an `auto` fix), 422 `runner.offline` for the folder, GitHub's
   * own errors as `github.errors.ts` maps them.
   */
  fix(pilotId: string, projectId: string, checkId: ReadinessFixId, seq: bigint): Promise<Project> {
    return this.enqueue(pilotId, async () => {
      const row = await this.prisma.scoped.project.findUnique({ where: { id: projectId }, select: READ_VIEW });
      if (!row) throw projectNotFound();
      assertFresh(row.lastSeq, seq);
      const check = toProject(row).readiness?.checks.find((candidate) => candidate.id === checkId);
      if (!check || check.state === 'ok' || check.fix !== 'auto') throw fixUnavailable();
      if (checkId === 'folder') {
        await this.prepareFolder(pilotId, row);
        await this.compute(pilotId, projectId, {});
      } else {
        const repo = repoOf(row);
        if (!repo) throw fixUnavailable();
        if (checkId === 'labels') await this.ensureLabels(repo);
        else await this.ensureIntegrationBranch(repo, row.releaseBranch, row.integrationBranch);
        await this.compute(pilotId, projectId, { github: true });
      }
      const after = await this.prisma.scoped.project.findUnique({ where: { id: projectId }, select: PROJECT_VIEW });
      if (!after) throw projectNotFound();
      return toProject(after);
    });
  }

  // --- The fixes

  private async ensureLabels(repo: RepoRef): Promise<void> {
    const present = new Set((await this.github.listLabels(repo)).map((label) => label.name));
    for (const label of PROCESS_LABELS) {
      if (!present.has(label.name)) await this.github.ensureLabel(repo, { name: label.name, color: label.color, description: label.description });
    }
  }

  private async ensureIntegrationBranch(repo: RepoRef, release: string, integration: string): Promise<void> {
    const from = await this.github.getBranch(repo, release);
    if (!from) throw fixUnavailable();
    if (await this.github.getBranch(repo, integration)) return;
    await this.github.createBranch(repo, integration, from.sha);
  }

  /** The folder's preparation to the Runner, its check `pending` until `project.folder.prepared`. */
  private async prepareFolder(pilotId: string, row: { id: string; releaseBranch: string; integrationBranch: string; readinessFacts: Prisma.JsonValue }): Promise<void> {
    if (!this.presence.isOnline(pilotId)) throw runnerOffline();
    const requestId = newId();
    this.commands.send(pilotId, { type: 'project.folder.prepare', requestId, projectId: row.id, releaseBranch: row.releaseBranch, integrationBranch: row.integrationBranch });
    await this.storeFacts(row.id, { ...storedFactsOf(row.readinessFacts), preparing: requestId, error: null });
  }

  // --- What the Runner says of a folder

  private async folderState(message: ProjectFolderStateMessage): Promise<void> {
    const row = await this.prisma.scoped.project.findUnique({ where: { id: message.projectId }, select: { folderState: true, releaseBranch: true, integrationBranch: true, readinessFacts: true } });
    if (!row || row.folderState === null) return;
    const { present, isGit, hasCommits, releaseBranch, integrationBranch } = message;
    const folder = { present, isGit, hasCommits, releaseBranch, integrationBranch, release: row.releaseBranch, integration: row.integrationBranch };
    await this.storeFacts(message.projectId, { ...storedFactsOf(row.readinessFacts), folder });
    await this.compute(currentPilotId(), message.projectId, {});
  }

  private async folderPrepared(message: ProjectFolderPrepared): Promise<void> {
    const row = await this.prisma.scoped.project.findUnique({ where: { id: message.projectId }, select: { readinessFacts: true } });
    if (!row) return;
    const stored = storedFactsOf(row.readinessFacts);
    if (stored.preparing !== message.requestId) return;
    await this.storeFacts(message.projectId, { ...stored, preparing: null, error: message.ok ? null : (message.error ?? 'git-failed') });
    await this.compute(currentPilotId(), message.projectId, {});
  }

  // --- The triggers

  private published(pilotId: string, event: Event): void {
    const [resource] = event.type.split('.');
    if (RECOMPUTED_ON.has(resource ?? '')) return this.later(pilotId, null, {});
    if (event.type === 'process.upserted') return this.later(pilotId, (event.payload as { id: string }).id, {});
    if (event.type !== 'project.upserted') return;
    const parsed = zProject.safeParse(event.payload);
    if (!parsed.success || this.inputs.get(parsed.data.id) === inputsOf(parsed.data)) return;
    this.later(pilotId, parsed.data.id, {});
  }

  private async pushed(event: GitHubEvent): Promise<void> {
    const ref = event.payload['ref'];
    if (typeof ref !== 'string' || !ref.startsWith('refs/heads/')) return;
    const branch = ref.slice('refs/heads/'.length);
    for (const project of await this.projectsOf(event)) {
      if (project.releaseBranch === branch || project.integrationBranch === branch) await this.recompute(event.pilotId, project.id, { github: true });
    }
  }

  private async labelled(event: GitHubEvent): Promise<void> {
    for (const project of await this.projectsOf(event)) await this.recompute(event.pilotId, project.id, { github: true });
  }

  private async projectsOf(event: GitHubEvent): Promise<{ id: string; releaseBranch: string; integrationBranch: string }[]> {
    const repository = event.payload['repository'];
    const id = typeof repository === 'object' && repository !== null ? (repository as Record<string, unknown>)['id'] : undefined;
    if (typeof id !== 'number' || !Number.isSafeInteger(id)) return [];
    return this.prisma.scoped.project.findMany({ where: { githubRepoId: BigInt(id) }, select: { id: true, releaseBranch: true, integrationBranch: true } });
  }

  /** A computation queued from a trigger: its failure logged. `projectId` null for every Projet of the Pilote. */
  private later(pilotId: string, projectId: string | null, reads: RecomputeReads): void {
    const job = projectId === null ? () => this.recomputeAll(reads) : () => this.compute(pilotId, projectId, reads);
    this.enqueue(pilotId, job).catch((error: unknown) => this.logger.error({ err: error, projectId }, 'readiness recompute failed'));
  }

  private async recomputeAll(reads: RecomputeReads): Promise<void> {
    const pilotId = currentPilotId();
    for (const { id } of await this.prisma.scoped.project.findMany({ select: { id: true }, orderBy: { id: 'asc' } })) await this.compute(pilotId, id, reads);
  }

  private enqueue<T>(pilotId: string, job: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(pilotId) ?? Promise.resolve();
    const run = previous.then(() => runInPilotScope(pilotId, job));
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

  // --- The computation

  private async compute(pilotId: string, projectId: string, reads: RecomputeReads): Promise<void> {
    const row = await this.prisma.scoped.project.findUnique({ where: { id: projectId }, select: READ_VIEW });
    if (!row) return;
    let stored = storedFactsOf(row.readinessFacts);
    const process = await readProjectProcess(this.prisma.scoped, projectId);
    const sources = processSourcesOf(process);
    const names = { release: row.releaseBranch, integration: row.integrationBranch };
    // Read again on a trigger, when never read, and once a branch is renamed.
    const stale = (figures: BranchNames | null): boolean => figures === null || figures.release !== names.release || figures.integration !== names.integration;

    const repo = repoOf(row);
    if (repo && !row.accessLost && (sources.ticket === 'github' || sources.code === 'github') && (reads.github || stale(stored.github))) {
      const github = await this.readGitHub(repo, sources, names);
      if (github) stored = { ...stored, github };
    }
    if (row.folderState !== null && (reads.folder || stale(stored.folder))) this.askFolder(pilotId, row.id, names);

    const definition = definitionOf({ process: { active: process.active, draft: process.draft, draftGaps: 0 } });
    const [roles, runner, mcpServers] = await Promise.all([
      this.roles.check(pilotId, { projectId, roleIds: roleIdsOf(definition) }),
      this.prisma.scoped.runner.findFirst({ where: { revokedAt: null }, select: { machine: true, state: true } }),
      this.prisma.scoped.mcpServer.findMany({ select: { name: true, state: true } }),
    ]);
    const project = toProject(row);
    const facts: ReadinessFacts = {
      projectId,
      runner: runner ? { machine: runner.machine, online: runner.state === 'online' } : null,
      folder: row.folderState === null ? null : { state: row.folderState, last: stored.folder, preparing: stored.preparing !== null, error: stored.error },
      releaseBranch: row.releaseBranch,
      integrationBranch: row.integrationBranch,
      process: {
        active: process.active,
        draft: process.draft,
        draftGaps: !process.active && process.draft ? findGaps(process.draft.definition, sources).length : 0,
      },
      roles,
      mcpServers,
      sources,
      repository: row.repositoryId === null ? null : { accessLost: row.accessLost },
      github: stored.github,
      hasCode: row.hasCode,
      inventoryState: project.inventoryState,
    };
    const readiness = evaluateReadiness(facts);
    this.inputs.set(projectId, inputsOf(project));
    const factsChanged = !isDeepStrictEqual(stored, storedFactsOf(row.readinessFacts));
    if (sameReadiness(row.readiness, readiness) && !factsChanged) return;
    if (sameReadiness(row.readiness, readiness)) {
      await this.storeFacts(projectId, stored);
      return;
    }
    await this.transactions.run(async (tx) => {
      await this.events.lock(tx, pilotId);
      const view = toProject(
        await tx.project.update({
          where: { id: projectId },
          data: { readiness: readiness as unknown as Prisma.InputJsonValue, readinessFacts: stored as unknown as Prisma.InputJsonValue },
          select: PROJECT_VIEW,
        }),
      );
      const seq = await this.events.write(tx, pilotId, 'project.upserted', view);
      await tx.project.update({ where: { id: projectId }, data: { lastSeq: seq } });
    });
  }

  /** The labels and the branches the Sources put on GitHub; `null` when GitHub fails (the figures read before stay). */
  private async readGitHub(repo: RepoRef, sources: ProcessSources, names: BranchNames): Promise<ReadinessStoredFacts['github']> {
    try {
      let labelsMissing = 0;
      if (sources.ticket === 'github') {
        const present = new Set((await this.github.listLabels(repo)).map((label) => label.name));
        labelsMissing = PROCESS_LABELS.filter((label) => !present.has(label.name)).length;
      }
      let releaseBranch = true;
      let integrationBranch = true;
      if (sources.code === 'github') {
        releaseBranch = (await this.github.getBranch(repo, names.release)) !== null;
        integrationBranch = (await this.github.getBranch(repo, names.integration)) !== null;
      }
      return { labelsMissing, releaseBranch, integrationBranch, ...names };
    } catch (error) {
      this.logger.warn({ code: error instanceof AppError ? error.code : undefined }, 'readiness: github not read');
      return null;
    }
  }

  /** `project.folder.status` to the Runner; offline, the folder's last state stays. */
  private askFolder(pilotId: string, projectId: string, names: BranchNames): void {
    try {
      this.commands.send(pilotId, { type: 'project.folder.status', projectId, releaseBranch: names.release, integrationBranch: names.integration });
    } catch (error) {
      if (!(error instanceof AppError && error.code === 'runner.offline')) throw error;
    }
  }

  private async storeFacts(projectId: string, facts: ReadinessStoredFacts): Promise<void> {
    await this.prisma.scoped.project.update({ where: { id: projectId }, data: { readinessFacts: facts as unknown as Prisma.InputJsonValue }, select: { id: true } });
  }
}

const repoOf = (row: { owner: string | null; name: string | null; githubRepoId: bigint | null }): RepoRef | null =>
  row.owner === null || row.name === null || row.githubRepoId === null ? null : { owner: row.owner, name: row.name, id: Number(row.githubRepoId) };
