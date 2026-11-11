import { Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { runInPilotScope } from '../../scope/scope.context.js';
import { GitHubInstallations } from './installations.js';
import { actionOf, installationFactsOf, installationIdOf, type WebhookPayload } from './payload.js';
import { safeError } from './safe-error.js';

/**
 * What a handler gets of a delivery. `payload` stays in memory: a handler
 * reads the metadata it needs and never stores nor logs a `body`, a comment
 * or a diff (ADR 0003).
 */
export interface GitHubEvent<PilotId extends string | null = string> {
  readonly deliveryId: string;
  /** The installation's Pilote; `null` only for an `installation` handler, before that Pilote signs in. */
  readonly pilotId: PilotId;
  readonly installationId: number;
  /** `X-GitHub-Event`: `issues`, `pull_request`… */
  readonly event: string;
  /** The payload's `action` (`opened`, `created`…), when it has one. */
  readonly action: string | undefined;
  readonly payload: WebhookPayload;
  /** When the server received it: `EventsWriter.write`'s `sourceAt`, the latency of ADR 0007. */
  readonly sourceAt: Date;
}

export type GitHubEventHandler<PilotId extends string | null = string> = (event: GitHubEvent<PilotId>) => void | Promise<void>;

/**
 * The webhooks' subscriptions: a module calls `on(eventName, handler)` when
 * it starts (`onModuleInit`). A handler runs in the scope of the
 * installation's Pilote (ADR 0008); an `installation` handler runs for an
 * installation no Pilote is linked to yet too, outside any scope.
 */
@Injectable()
export class GitHubEvents {
  private readonly handlers = new Map<string, GitHubEventHandler<string | null>[]>();

  on(eventName: 'installation', handler: GitHubEventHandler<string | null>): void;
  on(eventName: string, handler: GitHubEventHandler): void;
  on(eventName: string, handler: GitHubEventHandler<string | null> | GitHubEventHandler): void {
    const handlers = this.handlers.get(eventName) ?? [];
    handlers.push(handler as GitHubEventHandler<string | null>);
    this.handlers.set(eventName, handlers);
  }

  /** The handlers of `eventName`, in the order they subscribed. */
  of(eventName: string): readonly GitHubEventHandler<string | null>[] {
    return this.handlers.get(eventName) ?? [];
  }
}

/** A delivery whose signature was checked and which was not seen before. */
export interface AcceptedDelivery {
  readonly deliveryId: string;
  readonly event: string;
  readonly payload: WebhookPayload;
  readonly receivedAt: Date;
}

/**
 * Runs the deliveries the controller accepted, after its 202: in the order
 * of reception per installation, one after the other. For an `installation`
 * event it keeps the installations index first (`created`, `suspend`,
 * `unsuspend`; `deleted` once its handlers ran, so that they still know its
 * Pilote), then resolves the Pilote and calls each handler of the event in
 * that Pilote's scope. A handler that throws is logged by delivery id and
 * event name, never the payload nor the error's message (`safeError`), and
 * the others still run.
 */
@Injectable()
export class WebhookDispatcher implements OnApplicationShutdown {
  /** The last delivery queued per installation: the next one waits for it. */
  private readonly queues = new Map<number, Promise<void>>();

  constructor(
    private readonly events: GitHubEvents,
    private readonly installations: GitHubInstallations,
    @InjectPinoLogger(WebhookDispatcher.name) private readonly logger: PinoLogger,
  ) {}

  /**
   * Queues `delivery` behind the ones of its installation, and returns at
   * once: its place is taken when it is received, so that a record which ends
   * after the next delivery's does not reorder them. It runs only if
   * `recorded` resolves to `true` (its first reception); a duplicate, or a
   * record that failed, gives up its place.
   */
  enqueue(delivery: AcceptedDelivery, recorded: Promise<boolean>): void {
    const accepted = recorded.then(
      (first) => first,
      () => false,
    );
    const installationId = installationIdOf(delivery.payload);
    if (installationId === undefined) {
      void accepted.then((first) => {
        if (first) this.logger.info({ deliveryId: delivery.deliveryId, event: delivery.event }, 'webhook without an installation, not dispatched');
      });
      return;
    }
    const previous = this.queues.get(installationId) ?? Promise.resolve();
    const next = previous.then(async () => {
      if (await accepted) await this.dispatch(installationId, delivery);
    });
    this.queues.set(installationId, next);
    void next.finally(() => {
      if (this.queues.get(installationId) === next) this.queues.delete(installationId);
    });
  }

  /** Resolves once every delivery queued so far has run: the tests, and the shutdown. */
  async settled(): Promise<void> {
    while (this.queues.size > 0) await Promise.all(this.queues.values());
  }

  async onApplicationShutdown(): Promise<void> {
    await this.settled();
  }

  private async dispatch(installationId: number, { deliveryId, event, payload, receivedAt }: AcceptedDelivery): Promise<void> {
    const action = actionOf(payload);
    const log = { deliveryId, event, action, installationId };
    try {
      if (event === 'installation') await this.indexBefore(action, installationId, payload);
      const pilotId = await this.installations.pilotOf(installationId);
      const handlers = pilotId === null && event !== 'installation' ? [] : this.events.of(event);
      const context: GitHubEvent<string | null> = { deliveryId, pilotId, installationId, event, action, payload, sourceAt: receivedAt };
      for (const handler of handlers) {
        try {
          await (pilotId === null ? handler(context) : runInPilotScope(pilotId, () => handler(context)));
        } catch (error) {
          this.logger.error({ ...log, err: safeError(error) }, 'webhook handler failed');
        }
      }
      if (event === 'installation' && action === 'deleted') await this.installations.deleted(installationId);
    } catch (error) {
      this.logger.error({ ...log, err: safeError(error) }, 'webhook dispatch failed');
    }
  }

  private async indexBefore(action: string | undefined, installationId: number, payload: WebhookPayload): Promise<void> {
    if (action === 'created') {
      const facts = installationFactsOf(payload);
      if (facts) await this.installations.created(facts);
      else this.logger.warn({ installationId }, 'installation.created without its account or sender, not indexed');
    } else if (action === 'suspend' || action === 'unsuspend') {
      await this.installations.setSuspended(installationId, action === 'suspend');
    }
  }
}
