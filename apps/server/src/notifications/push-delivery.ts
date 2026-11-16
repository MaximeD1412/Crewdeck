import type { Decision } from '@crewdeck/contracts';
import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { Transactions } from '../realtime/transactions.js';
import { runInPilotScope } from '../scope/scope.context.js';
import { SettingsService } from '../settings/settings.service.js';
import { pushPayloadOf } from './push-payload.js';
import { PushSender } from './push-sender.js';
import { PushSubscriptions, type PushTarget } from './push-subscriptions.js';

type Claimed = Pick<Decision, 'id' | 'kind' | 'label' | 'link'>;

/**
 * Pushes Décisions to every browser of the Pilote (ATOI-4), when `PushRule`
 * says so: nothing when the account has `notifications.push` off, nor for a
 * Décision whose Projet has it off (`SettingsService.effective`); only the
 * Décisions still open and never pushed, `notified_at` set as they are
 * claimed (two pushes never send one twice). A subscription its push service
 * says is gone (404, 410) is removed, with its event. Never rejects: a
 * failure is logged, the Décision stays on « À toi ».
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

  /** `decision`, just raised while the Pilote is away. */
  now(pilotId: string, decision: Pick<Decision, 'id'>): Promise<void> {
    return this.deliver(pilotId, [decision.id]);
  }

  /** The Décisions `ids` that waited for the Pilote to be away: one notification for them all. */
  waiting(pilotId: string, ids: readonly string[]): Promise<void> {
    return this.deliver(pilotId, ids);
  }

  private async deliver(pilotId: string, ids: readonly string[]): Promise<void> {
    try {
      await runInPilotScope(pilotId, () => this.push(pilotId, ids));
    } catch (error) {
      this.logger.error({ err: error }, 'push delivery failed');
    }
  }

  private async push(pilotId: string, ids: readonly string[]): Promise<void> {
    if (ids.length === 0 || !(await this.settings.effective(pilotId)).notifications.push) return;
    const claim = await this.claim(pilotId, ids);
    if (!claim) return;
    const payload = pushPayloadOf(claim.decisions);
    const outcomes = await Promise.all(claim.targets.map(async (target) => ({ target, outcome: await this.sender.send(target, payload) })));
    const sent = outcomes.filter(({ outcome }) => outcome === 'sent').map(({ target }) => target.id);
    const gone = outcomes.filter(({ outcome }) => outcome === 'gone').map(({ target }) => target.id);
    await this.transactions.run(async (tx) => {
      for (const id of gone) await this.subscriptions.removed(tx, pilotId, id);
      await this.subscriptions.pushed(tx, sent, new Date());
    });
  }

  /** The browsers, and the Décisions of `ids` this push takes (marked pushed): nothing to send without either. */
  private claim(pilotId: string, ids: readonly string[]): Promise<{ targets: PushTarget[]; decisions: Claimed[] } | null> {
    return this.transactions.run(async (tx) => {
      const targets = await this.subscriptions.targets(tx);
      if (targets.length === 0) return null;
      const candidates = await tx.decision.findMany({
        where: { id: { in: [...ids] }, state: 'open', notifiedAt: null },
        select: { id: true, projectId: true },
      });
      const allowed = await this.allowedByProject(pilotId, candidates);
      if (allowed.length === 0) return null;
      const rows = await tx.decision.updateManyAndReturn({
        where: { id: { in: allowed }, state: 'open', notifiedAt: null },
        data: { notifiedAt: new Date() },
        select: { id: true, kind: true, label: true, link: true, createdAt: true },
      });
      if (rows.length === 0) return null;
      const decisions = rows
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        .map(({ id, kind, label, link }) => ({ id, kind: kind as Decision['kind'], label, link }));
      return { targets, decisions };
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
