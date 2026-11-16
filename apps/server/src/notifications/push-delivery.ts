import type { Decision } from '@crewdeck/contracts';
import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { type Tx, Transactions } from '../realtime/transactions.js';
import { runInPilotScope } from '../scope/scope.context.js';
import { SettingsService } from '../settings/settings.service.js';
import { pushPayloadOf } from './push-payload.js';
import { PushSender, type PushOutcome } from './push-sender.js';
import { PushSubscriptions, type PushTarget } from './push-subscriptions.js';

type Claimed = Pick<Decision, 'id' | 'kind' | 'label' | 'link'>;

/**
 * What a push gave: `retry` when it had Décisions to send and reached no
 * browser because a push service failed (they still wait), `done` otherwise.
 */
export type PushResult = 'done' | 'retry';

/** The Décisions still waiting for the Pilote: open, neither pushed nor seen (`notified_at`). */
const WAITING = { state: 'open', notifiedAt: null } as const;

/**
 * Pushes to every browser of the Pilote (ATOI-4), when `PushRule` says so,
 * the Décisions still waiting for them: read from the database, so a restart
 * loses none. `notified_at` says the Pilote has been told, by a push or by a
 * tab of theirs visible again (`seen`); a Décision whose push the account or
 * its Projet has off (`SettingsService.effective`) counts as told too, and
 * is never pushed later.
 * The Décisions are claimed (`notified_at` set) before they are sent, so two
 * pushes never send one twice, and handed back when no browser got them.
 * A subscription its push service says is gone (404, 410) is removed, with
 * its event. Never rejects: a failure is logged, the Décision stays on
 * « À toi ».
 */
@Injectable()
export class PushDelivery {
  constructor(
    private readonly transactions: Transactions,
    private readonly subscriptions: PushSubscriptions,
    private readonly settings: SettingsService,
    private readonly sender: PushSender,
    @InjectPinoLogger(PushDelivery.name) private readonly logger: PinoLogger,
  ) {}

  /** Pushes what waits for `pilotId`, as one notification. */
  async push(pilotId: string): Promise<PushResult> {
    try {
      return await runInPilotScope(pilotId, () => this.deliver(pilotId));
    } catch (error) {
      this.logger.error({ err: error }, 'push delivery failed');
      return 'retry';
    }
  }

  /** A tab of `pilotId` visible again at `at`: what waited before is seen, never pushed. */
  async seen(pilotId: string, at: Date): Promise<void> {
    try {
      await runInPilotScope(pilotId, () =>
        this.transactions.run((tx) => tx.decision.updateMany({ where: { ...WAITING, createdAt: { lt: at } }, data: { notifiedAt: at } })),
      );
    } catch (error) {
      this.logger.error({ err: error }, 'push seen failed');
    }
  }

  private async deliver(pilotId: string): Promise<PushResult> {
    const at = new Date();
    if (!(await this.settings.effective(pilotId)).notifications.push) {
      await this.transactions.run((tx) => tx.decision.updateMany({ where: WAITING, data: { notifiedAt: at } }));
      return 'done';
    }
    const claim = await this.claim(pilotId, at);
    if (!claim) return 'done';
    const payload = pushPayloadOf(claim.decisions);
    const outcomes = await Promise.all(
      claim.targets.map(async (target) => ({ target, outcome: await this.sender.send(target, payload).catch((): PushOutcome => 'failed') })),
    );
    const sent = outcomes.filter(({ outcome }) => outcome === 'sent').map(({ target }) => target.id);
    const gone = outcomes.filter(({ outcome }) => outcome === 'gone').map(({ target }) => target.id);
    await this.transactions.run(async (tx) => {
      for (const id of gone) await this.subscriptions.removed(tx, pilotId, id);
      await this.subscriptions.pushed(tx, sent, new Date());
      if (sent.length === 0) await this.handBack(tx, claim.decisions, at);
    });
    return sent.length === 0 && outcomes.some(({ outcome }) => outcome === 'failed') ? 'retry' : 'done';
  }

  /**
   * The browsers, and the Décisions waiting this push takes (marked told,
   * those whose Projet has push off with them): nothing to send without
   * either. No browser, and what waits keeps waiting, for one to come.
   */
  private claim(pilotId: string, at: Date): Promise<{ targets: PushTarget[]; decisions: Claimed[] } | null> {
    return this.transactions.run(async (tx) => {
      const targets = await this.subscriptions.targets(tx);
      if (targets.length === 0) return null;
      const candidates = await tx.decision.findMany({ where: WAITING, select: { id: true, projectId: true } });
      if (candidates.length === 0) return null;
      const allowed = new Set(await this.allowedByProject(pilotId, candidates));
      const rows = await tx.decision.updateManyAndReturn({
        where: { ...WAITING, id: { in: candidates.map(({ id }) => id) } },
        data: { notifiedAt: at },
        select: { id: true, kind: true, label: true, link: true, createdAt: true },
      });
      const decisions = rows
        .filter(({ id }) => allowed.has(id))
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        .map(({ id, kind, label, link }) => ({ id, kind: kind as Decision['kind'], label, link }));
      return decisions.length === 0 ? null : { targets, decisions };
    });
  }

  /** `decisions`, claimed at `at` and sent to no browser, waiting again (unless seen meanwhile). */
  private handBack(tx: Tx, decisions: readonly Claimed[], at: Date): Promise<unknown> {
    return tx.decision.updateMany({ where: { id: { in: decisions.map(({ id }) => id) }, notifiedAt: at }, data: { notifiedAt: null } });
  }

  /** The ids of `candidates` whose Projet (if any) has push on, its settings read once per Projet. */
  private async allowedByProject(pilotId: string, candidates: readonly { id: string; projectId: string | null }[]): Promise<string[]> {
    const projects = [...new Set(candidates.flatMap(({ projectId }) => (projectId ? [projectId] : [])))];
    const on = new Map(
      await Promise.all(projects.map(async (projectId) => [projectId, (await this.settings.effective(pilotId, projectId)).notifications.push] as const)),
    );
    return candidates.filter(({ projectId }) => projectId === null || on.get(projectId) === true).map(({ id }) => id);
  }
}
