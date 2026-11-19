import type { Decision } from '@crewdeck/contracts';
import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { Transactions } from '../realtime/transactions.js';
import { runInPilotScope } from '../scope/scope.context.js';
import { SettingsService } from '../settings/settings.service.js';
import { pushPayloadOf } from './push-payload.js';
import { PushSender, type PushOutcome } from './push-sender.js';
import { PushSubscriptions, type PushTarget } from './push-subscriptions.js';

type Claimed = Pick<Decision, 'id' | 'kind' | 'label' | 'link'>;

/**
 * How long a push holds the Décisions it took (`push_claimed_at`), well over
 * a send (`PUSH_SEND_TIMEOUT_MS`): a claim older than that belongs to a push
 * that never finished (the server stopped, its hand back failed), and what
 * it took waits again.
 */
export const PUSH_CLAIM_MS = 2 * 60_000;

/**
 * What a push gave: `retry` when Décisions still wait that it could not push,
 * because a push service failed or another push holds them (perhaps one
 * interrupted), `done` otherwise.
 */
export type PushResult = 'done' | 'retry';

/** The Décisions the Pilote has not been told of: open, neither pushed nor seen (`notified_at`). */
const UNTOLD = { state: 'open', notifiedAt: null } as const;

/** Those of them no push holds at `at`: never claimed, or by a push whose claim has lapsed. */
const free = (at: Date) => ({ ...UNTOLD, OR: [{ pushClaimedAt: null }, { pushClaimedAt: { lt: new Date(at.getTime() - PUSH_CLAIM_MS) } }] });

/**
 * Pushes to every browser of the Pilote (ATOI-4), when `PushRule` says so,
 * the Décisions still waiting for them: read from the database, so a restart
 * loses none. `notified_at` says the Pilote has been told, by a push or by a
 * tab of theirs visible again (`seen`); a Décision whose push the account or
 * its Projet has off (`SettingsService.effective`) counts as told too, and
 * is never pushed later.
 * A push claims the Décisions it sends (`push_claimed_at`), so two pushes
 * never send one twice; they are told once a browser got them, handed back
 * otherwise, and a claim that outlives `PUSH_CLAIM_MS` lapses. A Décision
 * seen while a push holds it stays seen, whatever that push gives.
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

  /** A tab of `pilotId` visible again at `at`: what waited before is seen, never pushed, even one a push holds. */
  async seen(pilotId: string, at: Date): Promise<void> {
    try {
      await runInPilotScope(pilotId, () =>
        this.transactions.run((tx) => tx.decision.updateMany({ where: { ...UNTOLD, createdAt: { lt: at } }, data: { notifiedAt: at } })),
      );
    } catch (error) {
      this.logger.error({ err: error }, 'push seen failed');
    }
  }

  private async deliver(pilotId: string): Promise<PushResult> {
    const at = new Date();
    if (!(await this.settings.effective(pilotId)).notifications.push) {
      await this.transactions.run((tx) => tx.decision.updateMany({ where: UNTOLD, data: { notifiedAt: at } }));
      return 'done';
    }
    const claim = await this.claim(pilotId, at);
    if (claim.decisions.length === 0) return claim.held ? 'retry' : 'done';
    const payload = pushPayloadOf(claim.decisions);
    const outcomes = await Promise.all(
      claim.targets.map(async (target) => ({ target, outcome: await this.sender.send(target, payload).catch((): PushOutcome => 'failed') })),
    );
    const sent = outcomes.filter(({ outcome }) => outcome === 'sent').map(({ target }) => target.id);
    const gone = outcomes.filter(({ outcome }) => outcome === 'gone').map(({ target }) => target.id);
    const ids = claim.decisions.map(({ id }) => id);
    const left = await this.transactions.run(async (tx) => {
      for (const id of gone) await this.subscriptions.removed(tx, pilotId, id);
      await this.subscriptions.pushed(tx, sent, new Date());
      if (sent.length > 0) await tx.decision.updateMany({ where: { id: { in: ids }, notifiedAt: null }, data: { notifiedAt: at } });
      // Handed back, or done with: the claim of this push only, one lapsed and taken again kept.
      await tx.decision.updateMany({ where: { id: { in: ids }, pushClaimedAt: at }, data: { pushClaimedAt: null } });
      return tx.decision.count({ where: { ...UNTOLD, id: { in: ids } } });
    });
    const failed = left > 0 && outcomes.some(({ outcome }) => outcome === 'failed');
    return failed || claim.held ? 'retry' : 'done';
  }

  /**
   * The browsers, and the Décisions free at `at` this push takes (claimed;
   * those whose Projet has push off told, never pushed): none without a
   * browser, and what waits keeps waiting, for one to come. `held`, whether
   * another push holds some still.
   */
  private claim(pilotId: string, at: Date): Promise<{ targets: PushTarget[]; decisions: Claimed[]; held: boolean }> {
    return this.transactions.run(async (tx) => {
      const targets = await this.subscriptions.targets(tx);
      if (targets.length === 0) return { targets, decisions: [], held: false };
      const candidates = await tx.decision.findMany({ where: free(at), select: { id: true, projectId: true } });
      const allowed = new Set(await this.allowedByProject(pilotId, candidates));
      const off = candidates.filter(({ id }) => !allowed.has(id)).map(({ id }) => id);
      if (off.length > 0) await tx.decision.updateMany({ where: { ...UNTOLD, id: { in: off } }, data: { notifiedAt: at } });
      const rows = await tx.decision.updateManyAndReturn({
        where: { ...free(at), id: { in: [...allowed] } },
        data: { pushClaimedAt: at },
        select: { id: true, kind: true, label: true, link: true, createdAt: true },
      });
      const held = (await tx.decision.count({ where: { ...UNTOLD, pushClaimedAt: { not: null }, NOT: { pushClaimedAt: at } } })) > 0;
      const decisions = rows
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        .map(({ id, kind, label, link }) => ({ id, kind: kind as Decision['kind'], label, link }));
      return { targets, decisions, held };
    });
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
