import { Injectable } from '@nestjs/common';
import { Interval, Timeout } from '@nestjs/schedule';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { runInPilotScope } from '../../scope/scope.context.js';
import { GitHubInstallations } from '../webhooks/installations.js';

/** The first run, after the server starts: what a webhook missed while it was down. */
export const RECONCILE_FIRST_AFTER_MS = 10_000;
/** Then every 15 min (ADR 0002): what a webhook lost. */
export const RECONCILE_EVERY_MS = 15 * 60_000;

/** What a hook gets: one installation, its Pilote's scope open. */
export interface ReconcileTarget {
  readonly pilotId: string;
  readonly installationId: number;
}

/** A module's re-read of what it owns on GitHub (the repositories, the issues and PRs…). */
export interface ReconcileHook {
  /** Its name in the logs: `repositories`, `issues`… */
  readonly key: string;
  reconcile(target: ReconcileTarget): void | Promise<void>;
}

/**
 * The reconciliation's hooks: a module calls `register(hook)` when it starts
 * (`onModuleInit`). The module that owns a resource knows what to re-read.
 */
@Injectable()
export class ReconcileHooks {
  private readonly hooks: ReconcileHook[] = [];

  register(hook: ReconcileHook): void {
    this.hooks.push(hook);
  }

  all(): readonly ReconcileHook[] {
    return this.hooks;
  }
}

/**
 * Once `RECONCILE_FIRST_AFTER_MS` after boot, then every `RECONCILE_EVERY_MS`:
 * for each linked, unsuspended installation, in its Pilote's scope (ADR 0008),
 * every hook, one after the other. A hook that throws is logged and the
 * others go on; a tick while a run is still going is skipped.
 */
@Injectable()
export class Reconciliation {
  private running = false;

  constructor(
    private readonly hooks: ReconcileHooks,
    private readonly installations: GitHubInstallations,
    @InjectPinoLogger(Reconciliation.name) private readonly logger: PinoLogger,
  ) {}

  @Timeout('github-reconciliation-boot', RECONCILE_FIRST_AFTER_MS)
  async afterBoot(): Promise<void> {
    await this.run();
  }

  @Interval('github-reconciliation', RECONCILE_EVERY_MS)
  async every(): Promise<void> {
    await this.run();
  }

  /** One run, unless one is going; `false` when skipped. */
  async run(): Promise<boolean> {
    if (this.running) {
      this.logger.info('reconciliation still running, tick skipped');
      return false;
    }
    this.running = true;
    try {
      for (const target of await this.installations.linked()) await this.reconcile(target);
    } catch (error) {
      this.logger.error({ err: error }, 'reconciliation failed');
    } finally {
      this.running = false;
    }
    return true;
  }

  private async reconcile(target: ReconcileTarget): Promise<void> {
    await runInPilotScope(target.pilotId, async () => {
      for (const hook of this.hooks.all()) {
        try {
          await hook.reconcile(target);
        } catch (error) {
          this.logger.error({ key: hook.key, installationId: target.installationId, pilotId: target.pilotId, err: error }, 'reconcile hook failed');
        }
      }
    });
  }
}
