import type { GitHubChange, Hello } from '@crewdeck/contracts';
import { Injectable, type OnModuleInit } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { PrismaService } from '../../prisma/prisma.service.js';
import { ProjectChanges } from '../../projects/project-changes.js';
import { type OutgoingRunnerMessage, type RunnerLink, RunnerConnections, stamp } from '../../runners/runner-connections.js';
import { runInPilotScope } from '../../scope/scope.context.js';
import { CHANGE_VIEW, toChange } from './change.view.js';
import { mirrorProjectsOf } from './mirror-projects.js';

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
 * last seq. After it, each change committed is sent once, in the order of
 * its seq: one that arrives ahead of an older one sends the older first,
 * read from `github_changes`. A change missing on the way (purged while its
 * neighbours are kept) is `mirror.resync` then `mirror.live`, never a
 * hole. A `hello` without `mirrorAfter` (a Runner without a Miroir) gets
 * none of this. The Projets that change are sent again.
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
    const { counter, whole } = await this.prisma.scoped.$transaction(
      async (tx) => {
        const pilot = await tx.pilot.findUniqueOrThrow({ where: { id: pilotId }, select: { githubChangeSeq: true } });
        const last = Number(pilot.githubChangeSeq);
        if (after === null || after > last) return { counter: last, whole: false };
        const kept = await tx.gitHubChange.count({ where: { seq: { gt: BigInt(after), lte: BigInt(last) } } });
        return { counter: last, whole: kept === last - after };
      },
      { isolationLevel: 'RepeatableRead' },
    );
    stream.lastSent = after ?? 0;
    // A change missing (purged, its neighbours kept) is a resync, before the replay or during it.
    if (!whole || !(await this.sendThrough(stream, counter))) this.send(stream, { type: 'mirror.resync' });
    stream.lastSent = counter;
    this.send(stream, { type: 'mirror.live', seq: counter });
  }

  private async deliver(stream: Stream, change: GitHubChange): Promise<void> {
    if (change.seq <= stream.lastSent) return;
    if (change.seq > stream.lastSent + 1 && !(await this.sendThrough(stream, change.seq - 1))) {
      // An older change no longer kept: the Runner resyncs, then follows from this one.
      this.send(stream, { type: 'mirror.resync' });
      stream.lastSent = change.seq;
      this.send(stream, { type: 'mirror.live', seq: change.seq });
      return;
    }
    this.send(stream, { type: 'github.changed', change });
    stream.lastSent = change.seq;
  }

  /**
   * Sends the kept changes after `stream.lastSent` through `until`, a page at
   * a time; false as soon as one is missing (`stream.lastSent` is then the
   * last one sent).
   */
  private async sendThrough(stream: Stream, until: number): Promise<boolean> {
    while (stream.lastSent < until) {
      const rows = await this.prisma.scoped.gitHubChange.findMany({
        where: { seq: { gt: BigInt(stream.lastSent), lte: BigInt(until) } },
        orderBy: { seq: 'asc' },
        take: MIRROR_PAGE,
        select: CHANGE_VIEW,
      });
      if (rows.length === 0) return false;
      for (const row of rows) {
        if (Number(row.seq) !== stream.lastSent + 1) return false;
        this.send(stream, { type: 'github.changed', change: toChange(row) });
        stream.lastSent = Number(row.seq);
      }
    }
    return true;
  }

  private async sendProjects(stream: Stream): Promise<void> {
    this.send(stream, { type: 'mirror.projects', projects: await mirrorProjectsOf(this.prisma.scoped) });
  }

  private send(stream: Stream, message: OutgoingRunnerMessage): void {
    stream.link.send(stamp(message));
  }
}
