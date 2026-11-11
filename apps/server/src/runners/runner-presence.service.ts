import { type Hello, OFFLINE_AFTER_SECONDS } from '@crewdeck/contracts';
import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { EventsWriter } from '../realtime/events.writer.js';
import { Transactions, type Tx } from '../realtime/transactions.js';
import { runInPilotScope } from '../scope/scope.context.js';
import { RunnerClock } from './clock.js';
import { RUNNER_VIEW, toRunner } from './runner.view.js';

/** Called with the Runner's id once its change is committed. */
export type PresenceHandler = (runnerId: string) => void;

/** How long a Runner stays « en ligne » after its last heartbeat. */
export const OFFLINE_AFTER_MS = OFFLINE_AFTER_SECONDS * 1000;

/**
 * Whether each Pilote's Runner is « en ligne » (ADR 0004): online on an
 * accepted `hello`, `lastSeenAt` on each heartbeat, offline once its socket
 * closes or `OFFLINE_AFTER_SECONDS` after its last heartbeat (`RunnerSweep`),
 * back online at its next heartbeat. Each change of `state` (and each `hello`,
 * which may change its machine) writes `runner.upserted` in its transaction;
 * a heartbeat that changes nothing but `lastSeenAt` writes no event (the
 * events that matter, offline, carry it).
 *
 * The changes of one Pilote's Runner run one after the other, so that the
 * row, its events and what `isOnline` says follow the same order. In memory
 * (one server process): `isOnline` and the hooks of ATOI-3, RUNNER-9 and
 * RUNNER-12, called after the commit.
 */
@Injectable()
export class RunnerPresence {
  private readonly online = new Map<string, string>();
  private readonly onlineHooks = new Map<string, Set<PresenceHandler>>();
  private readonly offlineHooks = new Map<string, Set<PresenceHandler>>();
  private readonly queues = new Map<string, Promise<unknown>>();

  constructor(
    private readonly transactions: Transactions,
    private readonly events: EventsWriter,
    private readonly clock: RunnerClock,
    @InjectPinoLogger(RunnerPresence.name) private readonly logger: PinoLogger,
  ) {}

  /** Whether `pilotId`'s Runner is connected and has sent a heartbeat (or its `hello`) within `OFFLINE_AFTER_SECONDS`. */
  isOnline(pilotId: string): boolean {
    return this.online.has(pilotId);
  }

  /** Calls `handler` each time `pilotId`'s Runner comes online; returns its removal. */
  onOnline(pilotId: string, handler: PresenceHandler): () => void {
    return this.hook(this.onlineHooks, pilotId, handler);
  }

  /** Calls `handler` each time `pilotId`'s Runner goes offline; returns its removal. */
  onOffline(pilotId: string, handler: PresenceHandler): () => void {
    return this.hook(this.offlineHooks, pilotId, handler);
  }

  /**
   * An accepted `hello`: the Runner online, its machine as it describes it.
   * `accept` runs once the change is committed and before the `onOnline`
   * hooks, so that `hello.accepted` reaches the Runner before what a hook
   * sends; it says whether the socket was accepted. One that was not (closed
   * meanwhile, a newer one of the same Runner in its place) marks nothing
   * online: the newer one does, once its own `hello` is accepted.
   */
  connected(pilotId: string, runnerId: string, hello: Hello, protocolVersion: number, accept: () => boolean): Promise<void> {
    return this.serial(pilotId, async () => {
      const now = this.clock.now();
      await this.transactions.run(async (tx) => {
        const row = await tx.runner.update({
          where: { id: runnerId },
          data: {
            state: 'online',
            lastSeenAt: now,
            machine: hello.machine,
            os: hello.os,
            arch: hello.arch,
            wsl: hello.wsl,
            runnerVersion: hello.runnerVersion,
            protocolVersion,
          },
          select: RUNNER_VIEW,
        });
        await this.events.write(tx, pilotId, 'runner.upserted', toRunner(row));
      });
      if (accept()) this.markOnline(pilotId, runnerId);
    });
  }

  /** A heartbeat: `lastSeenAt` now, and the Runner back online when it had gone offline. */
  heartbeat(pilotId: string, runnerId: string): Promise<void> {
    return this.serial(pilotId, async () => {
      const now = this.clock.now();
      const back = await this.transactions.run(async (tx) => {
        const { count } = await tx.runner.updateMany({ where: { id: runnerId, state: 'offline', revokedAt: null }, data: { state: 'online', lastSeenAt: now } });
        if (count === 0) {
          await tx.runner.updateMany({ where: { id: runnerId }, data: { lastSeenAt: now } });
          return false;
        }
        await this.writeEvent(tx, pilotId, runnerId);
        return true;
      });
      // Online in memory too when the row already was: the socket was accepted.
      if (back || !this.online.has(pilotId)) this.markOnline(pilotId, runnerId);
    });
  }

  /** The Runner's socket closed: offline at once. */
  disconnected(pilotId: string, runnerId: string): Promise<void> {
    return this.serial(pilotId, async () => {
      const changed = await this.goOffline(pilotId, runnerId, {});
      this.markOffline(pilotId, runnerId, changed);
    });
  }

  /** Offline when its last heartbeat is older than `cutoff` (`RunnerSweep`); whether it went offline. */
  expire(pilotId: string, runnerId: string, cutoff: Date): Promise<boolean> {
    return this.serial(pilotId, async () => {
      const changed = await this.goOffline(pilotId, runnerId, { lastSeenAt: { lt: cutoff } });
      if (changed) this.markOffline(pilotId, runnerId, changed);
      return changed;
    });
  }

  private goOffline(pilotId: string, runnerId: string, where: { lastSeenAt?: { lt: Date } }): Promise<boolean> {
    return this.transactions.run(async (tx) => {
      const { count } = await tx.runner.updateMany({ where: { id: runnerId, state: 'online', revokedAt: null, ...where }, data: { state: 'offline' } });
      if (count === 0) return false;
      await this.writeEvent(tx, pilotId, runnerId);
      return true;
    });
  }

  private async writeEvent(tx: Tx, pilotId: string, runnerId: string): Promise<void> {
    const row = await tx.runner.findUniqueOrThrow({ where: { id: runnerId }, select: RUNNER_VIEW });
    await this.events.write(tx, pilotId, 'runner.upserted', toRunner(row));
  }

  private markOnline(pilotId: string, runnerId: string): void {
    const was = this.online.get(pilotId);
    this.online.set(pilotId, runnerId);
    if (was !== runnerId) this.call(this.onlineHooks, pilotId, runnerId);
  }

  /**
   * Offline in memory, with its hooks: when this process had the Runner
   * online, or when the row went offline (`committed`) without this process
   * knowing it online (a row left online by a server restarted). Never for a
   * Runner that another one of the Pilote has replaced.
   */
  private markOffline(pilotId: string, runnerId: string, committed: boolean): void {
    const current = this.online.get(pilotId);
    if (current === runnerId) this.online.delete(pilotId);
    else if (current !== undefined || !committed) return;
    this.call(this.offlineHooks, pilotId, runnerId);
  }

  /** Runs `fn` in `pilotId`'s scope, after the changes of their Runner already queued. */
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

  private hook(hooks: Map<string, Set<PresenceHandler>>, pilotId: string, handler: PresenceHandler): () => void {
    const handlers = hooks.get(pilotId) ?? new Set<PresenceHandler>();
    handlers.add(handler);
    hooks.set(pilotId, handlers);
    return () => {
      handlers.delete(handler);
      if (handlers.size === 0 && hooks.get(pilotId) === handlers) hooks.delete(pilotId);
    };
  }

  private call(hooks: Map<string, Set<PresenceHandler>>, pilotId: string, runnerId: string): void {
    for (const handler of [...(hooks.get(pilotId) ?? [])]) {
      try {
        handler(runnerId);
      } catch (error) {
        this.logger.error({ err: error }, 'runner presence hook failed');
      }
    }
  }
}
