import type { GitHubUser, UserTokens } from '@crewdeck/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { AppError } from '../errors/app-error.js';
import { GITHUB_CLIENT, type GitHubClient } from '../github/github.client.js';
import { Reconciliation } from '../github/reconciliation/reconciliation.service.js';
import { GitHubInstallations } from '../github/webhooks/installations.js';
import { newId } from '../ids.js';
import { publishMe } from '../pilots/me.controller.js';
import { EventsWriter } from '../realtime/events.writer.js';
import { Transactions } from '../realtime/transactions.js';
import { runInPilotScope } from '../scope/scope.context.js';
import { GithubTokens } from './github-tokens.js';
import { isUniqueViolation, PilotIdentities } from './identities.js';

/** Why « Relier GitHub » failed, as `<next>?erreur=` names it (the `AccountIdentities`' `error`). */
export type LinkError = 'github-already-linked' | 'github-other-account' | 'denied' | 'github-unavailable';

/**
 * « Relier GitHub » (ADR 0014): the GitHub user of a grant joins the signed-in
 * Pilote as their `github` Identité. A GitHub account already another
 * Pilote's is refused, never moved nor merged; a Pilote has one GitHub
 * account at most; their own one again is a reconnection, its tokens stored
 * anew.
 */
@Injectable()
export class GithubLinks {
  constructor(
    @Inject(GITHUB_CLIENT) private readonly github: GitHubClient,
    private readonly identities: PilotIdentities,
    private readonly tokens: GithubTokens,
    private readonly transactions: Transactions,
    private readonly events: EventsWriter,
    private readonly installations: GitHubInstallations,
    private readonly reconciliation: Reconciliation,
    private readonly logger: PinoLogger,
  ) {
    logger.setContext('GithubLinks');
  }

  /**
   * Links the GitHub user of `code` to `pilotId`: the Identité (or its login
   * refreshed), the tokens, the installations that user made before and
   * `pilot.upserted` in one transaction; once committed, their Dépôts GitHub
   * are reconciled at once, not awaited. `null` once linked.
   */
  async link(pilotId: string, code: string, callbackUrl: string): Promise<LinkError | null> {
    let tokens: UserTokens;
    let user: GitHubUser;
    try {
      tokens = await this.github.exchangeCode(code, callbackUrl);
      user = await this.github.getAuthenticatedUser(tokens.accessToken);
    } catch (failure) {
      if (!(failure instanceof AppError)) throw failure;
      this.logger.warn({ code: failure.code }, 'Linking GitHub failed');
      return 'github-unavailable';
    }
    // Two links of one GitHub account at once: the loser's insert violates a
    // unique index and rolls back; once more finds the winner's Identité.
    const outcome = await this.store(pilotId, user, tokens).catch((error: unknown) => {
      if (!isUniqueViolation(error)) throw error;
      return this.store(pilotId, user, tokens);
    });
    if (outcome) return outcome;
    void this.reconciliation.runFor(pilotId);
    return null;
  }

  private async store(pilotId: string, user: GitHubUser, tokens: UserTokens): Promise<LinkError | null> {
    const subject = String(user.id);
    const owner = await this.identities.pilotOf('github', subject);
    if (owner !== null && owner !== pilotId) return 'github-already-linked';
    return runInPilotScope(pilotId, () =>
      this.transactions.run(async (tx) => {
        const mine = await tx.pilotIdentity.findFirst({ where: { provider: 'github' }, select: { subject: true } });
        if (mine && mine.subject !== subject) return 'github-other-account';
        if (mine) await tx.pilotIdentity.updateMany({ where: { provider: 'github' }, data: { login: user.login } });
        else await tx.pilotIdentity.create({ data: { id: newId(), pilotId, provider: 'github', subject, email: null, login: user.login } });
        await this.tokens.store(tx, pilotId, tokens);
        await this.installations.linkPendingTo(pilotId, user.id, tx);
        await publishMe(tx, this.events, pilotId);
        return null;
      }),
    );
  }
}
