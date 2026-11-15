import type { GitHubChange, Hello, MirrorProject } from '@crewdeck/contracts';
import { Injectable, type OnModuleInit } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { PrismaService } from '../../prisma/prisma.service.js';
import { ProjectChanges } from '../../projects/project-changes.js';
import { type OutgoingRunnerMessage, type RunnerLink, RunnerConnections, stamp } from '../../runners/runner-connections.js';
import { runInPilotScope } from '../../scope/scope.context.js';
import { CHANGE_VIEW, toChange } from './change.view.js';

/** How many changes a replay reads at a time. */
export const MIRROR_PAGE = 500;

/** A Runner's Miroir followed: its socket, the last seq sent to it, its work in order. */
interface Stream {
  readonly link: RunnerLink;
  lastSent: number;
  queue: Promise<void>;
}

/** Closes a socket whose relay failed: the Runner's next `hello` replays from where its Miroir is. */
const RELAY_FAILED = 1011;

/**
 * Relays GitHub's changes to the Runner's Miroir (ADR 0010, MIROIR-1). A
 * `hello` with `mirrorAfter` starts its stream: `mirror.projects` (the
 * Projets to mirror), then the changes after `mirrorAfter`, or
 * `mirror.resync` when they are no longer all kept (or the Runner has none,
 * `null`, or says a seq the server never gave), then `mirror.live` with the
 * last seq sent. After it, each change committed is sent once, in the order
 * of its seq: one that arrives ahead of an older one sends the older first,
 * read from `github_changes`. A `hello` without `mirrorAfter` (a Runner
 * without a Miroir) gets none of this. The Projets that change are sent
 * again.
 *
 * A stream's work runs one task after the other; a task that fails closes
 * the socket with 1011, and the Runner's next `hello` replays.
 */
@Injectable()
export class MirrorRelay implements OnModuleInit {
  private readonly streams = new Map<string, Stream>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly connections: RunnerConnections,
    private readonly projectChanges: ProjectChanges,
    @InjectPinoLogger(MirrorRelay.name) private readonly logger: PinoLogger,
  ) {}

  onModuleInit(): void {
    this.connections.onAccepted((link, hello) => this.accepted(link, hello));
    this.projectChanges.onChanged((pilotId) => {
      const stream = this.current(pilotId);
      if (stream) this.enqueue(pilotId, stream, () => this.sendProjects(stream));
    });
  }

  /** `change`, committed: sent to the Pilote's Runner when its Miroir is followed. */
  publish(pilotId: string, change: GitHubChange): void {
    const stream = this.current(pilotId);
    if (stream) this.enqueue(pilotId, stream, () => this.deliver(stream, change));
  }

  /** Resolves once every stream's queued work is done (tests). */
  async settled(): Promise<void> {
    await Promise.all([...this.streams.values()].map((stream) => stream.queue));
  }

  private accepted(link: RunnerLink, hello: Hello): void {
    if (hello.mirrorAfter === undefined) {
      this.streams.delete(link.pilotId);
      return;
    }
    const after = hello.mirrorAfter;
    const stream: Stream = { link, lastSent: 0, queue: Promise.resolve() };
    this.streams.set(link.pilotId, stream);
    this.enqueue(link.pilotId, stream, () => this.replay(link.pilotId, stream, after));
  }

  /** The stream of `pilotId`'s Runner while its socket is the one connected; a stale one is forgotten. */
  private current(pilotId: string): Stream | undefined {
    const stream = this.streams.get(pilotId);
    if (!stream) return undefined;
    if (this.connections.of(pilotId) === stream.link) return stream;
    this.streams.delete(pilotId);
    return undefined;
  }

  private enqueue(pilotId: string, stream: Stream, task: () => Promise<void>): void {
    stream.queue = stream.queue.then(async () => {
      if (this.streams.get(pilotId) !== stream) return;
      try {
        await runInPilotScope(pilotId, task);
      } catch (error) {
        this.logger.error({ err: error }, 'mirror relay failed');
        if (this.streams.get(pilotId) === stream) this.streams.delete(pilotId);
        stream.link.close(RELAY_FAILED, 'mirror relay failed');
      }
    });
  }

  private async replay(pilotId: string, stream: Stream, after: number | null): Promise<void> {
    await this.sendProjects(stream);
    const { counter, oldest } = await this.prisma.scoped.$transaction(async (tx) => {
      const pilot = await tx.pilot.findUniqueOrThrow({ where: { id: pilotId }, select: { githubChangeSeq: true } });
      const first = await tx.gitHubChange.findFirst({ orderBy: { seq: 'asc' }, select: { seq: true } });
      return { counter: Number(pilot.githubChangeSeq), oldest: first ? Number(first.seq) : null };
    });
    const kept = after !== null && after <= counter && (oldest === null ? after === counter : oldest <= after + 1);
    if (kept) {
      stream.lastSent = after;
      await this.sendAfter(stream, Number.POSITIVE_INFINITY);
    } else {
      this.send(stream, { type: 'mirror.resync' });
    }
    stream.lastSent = Math.max(stream.lastSent, counter);
    this.send(stream, { type: 'mirror.live', seq: stream.lastSent });
  }

  private async deliver(stream: Stream, change: GitHubChange): Promise<void> {
    if (change.seq <= stream.lastSent) return;
    if (change.seq > stream.lastSent + 1) await this.sendAfter(stream, change.seq - 1);
    if (change.seq <= stream.lastSent) return;
    this.send(stream, { type: 'github.changed', change });
    stream.lastSent = change.seq;
  }

  /** Sends the kept changes after `stream.lastSent`, up to `until`, a page at a time. */
  private async sendAfter(stream: Stream, until: number): Promise<void> {
    for (;;) {
      const rows = await this.prisma.scoped.gitHubChange.findMany({
        where: { seq: { gt: BigInt(stream.lastSent), ...(Number.isFinite(until) ? { lte: BigInt(until) } : {}) } },
        orderBy: { seq: 'asc' },
        take: MIRROR_PAGE,
        select: CHANGE_VIEW,
      });
      for (const row of rows) {
        this.send(stream, { type: 'github.changed', change: toChange(row) });
        stream.lastSent = Number(row.seq);
      }
      if (rows.length < MIRROR_PAGE) return;
    }
  }

  private async sendProjects(stream: Stream): Promise<void> {
    this.send(stream, { type: 'mirror.projects', projects: await this.projectsOf() });
  }

  /** The Pilote's Projets whose access is not lost, with the installation that reaches each. */
  private async projectsOf(): Promise<MirrorProject[]> {
    return this.prisma.scoped.$transaction(async (tx) => {
      const projects = await tx.project.findMany({
        where: { accessLost: false },
        select: { id: true, repositoryId: true, githubRepoId: true, fullName: true, displayName: true, integrationBranch: true },
        orderBy: { followedAt: 'asc' },
      });
      const repositories = await tx.repository.findMany({ where: { id: { in: projects.map((project) => project.repositoryId) } }, select: { id: true, installationId: true } });
      const installations = new Map(repositories.map((repository) => [repository.id, Number(repository.installationId)]));
      return projects.flatMap((project) => {
        const installationId = installations.get(project.repositoryId);
        if (installationId === undefined) return [];
        return [
          {
            projectId: project.id,
            repository: project.fullName,
            githubRepoId: Number(project.githubRepoId),
            installationId,
            displayName: project.displayName,
            integrationBranch: project.integrationBranch,
          },
        ];
      });
    });
  }

  private send(stream: Stream, message: OutgoingRunnerMessage): void {
    stream.link.send(stamp(message));
  }
}
