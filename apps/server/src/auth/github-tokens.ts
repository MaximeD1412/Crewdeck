import type { GithubToken, UserTokens } from '@crewdeck/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { AppError } from '../errors/app-error.js';
import { MESSAGES } from '../errors/messages.js';
import { GITHUB_CLIENT, type GitHubClient } from '../github/github.client.js';
import { publishMe } from '../pilots/me.controller.js';
import { PrismaService, type ScopedPrisma } from '../prisma/prisma.service.js';
import { EventsWriter } from '../realtime/events.writer.js';
import { Transactions } from '../realtime/transactions.js';
import { currentPilotId } from '../scope/scope.context.js';
import { githubNotLinked } from './require-github.js';
import { TOKEN_KEY_VERSION, TokenCipher, TokenDecryptError } from './token-cipher.js';
import { WebSessions } from './web-sessions.js';

/** The access token is refreshed when less than this remains of it. */
export const REFRESH_WITHIN_MS = 5 * 60 * 1000;

export const githubExpired = (): AppError => new AppError(401, 'auth.github-expired', MESSAGES['auth.github-expired']);

/** Prisma's `Bytes`: a `Uint8Array` on an `ArrayBuffer` of its own. */
const bytes = (buffer: Buffer): Uint8Array<ArrayBuffer> => new Uint8Array(buffer);

/** The row of `tokens`, encrypted. */
const encrypted = (cipher: TokenCipher, tokens: UserTokens) => ({
  accessTokenEnc: bytes(cipher.encrypt(tokens.accessToken)),
  accessExpiresAt: new Date(tokens.accessTokenExpiresAt),
  refreshTokenEnc: bytes(cipher.encrypt(tokens.refreshToken)),
  refreshExpiresAt: new Date(tokens.refreshTokenExpiresAt),
  keyVersion: TOKEN_KEY_VERSION,
});

/**
 * The Pilote's GitHub user tokens (ADR 0002): stored encrypted at sign-in or
 * at « Relier GitHub », handed to the page (`POST /api/github/token`),
 * refreshed when about to expire. Without them, 409 `github.not-linked`. A
 * grant GitHub refuses, or tokens this key no longer opens, are deleted: a
 * Pilote whose only Identité is GitHub is signed out (every session ends, 401
 * `auth.github-expired`); one who signs in another way keeps their sessions,
 * and gets 409 `github.not-linked` and « Reconnecter GitHub » (ADR 0014).
 */
@Injectable()
export class GithubTokens {
  /** One refresh at a time per Pilote: GitHub's refresh tokens are single-use. */
  private readonly locks = new Map<string, Promise<void>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly cipher: TokenCipher,
    @Inject(GITHUB_CLIENT) private readonly github: GitHubClient,
    private readonly sessions: WebSessions,
    private readonly transactions: Transactions,
    private readonly events: EventsWriter,
  ) {}

  /** Stores `tokens` as the scope's Pilote's, written by `tx`. */
  async store(tx: Pick<ScopedPrisma, 'githubUserToken'>, pilotId: string, tokens: UserTokens): Promise<void> {
    const row = encrypted(this.cipher, tokens);
    await tx.githubUserToken.upsert({ where: { pilotId }, create: { pilotId, ...row }, update: row });
  }

  /** The scope's Pilote's access token, refreshed first when it expires within 5 minutes. */
  current(now = () => Date.now()): Promise<GithubToken> {
    const pilotId = currentPilotId();
    const previous = this.locks.get(pilotId) ?? Promise.resolve();
    const run = previous.then(() => this.read(pilotId, now()));
    // The next call waits for this one, failed or not; the last one frees the lock.
    const settled: Promise<void> = run.then(
      () => this.unlock(pilotId, settled),
      () => this.unlock(pilotId, settled),
    );
    this.locks.set(pilotId, settled);
    return run;
  }

  private unlock(pilotId: string, settled: Promise<void>): void {
    if (this.locks.get(pilotId) === settled) this.locks.delete(pilotId);
  }

  private async read(pilotId: string, now: number): Promise<GithubToken> {
    const row = await this.prisma.scoped.githubUserToken.findUnique({ where: { pilotId } });
    // No tokens: GitHub never linked, or its grant refused (a Pilote it signed out has no session left to ask).
    if (!row) throw githubNotLinked();
    try {
      if (row.accessExpiresAt.getTime() - now > REFRESH_WITHIN_MS) {
        return { accessToken: this.cipher.decrypt(row.accessTokenEnc), expiresAt: row.accessExpiresAt.toISOString() };
      }
      if (row.refreshExpiresAt.getTime() <= now) return await this.expire(row.refreshTokenEnc, pilotId, now);
      const tokens = await this.github.refreshUserToken(this.cipher.decrypt(row.refreshTokenEnc));
      await this.store(this.prisma.scoped, pilotId, tokens);
      return { accessToken: tokens.accessToken, expiresAt: tokens.accessTokenExpiresAt };
    } catch (error) {
      if (error instanceof TokenDecryptError || (error instanceof AppError && error.code === 'github.user-token-refused')) {
        return this.expire(row.refreshTokenEnc, pilotId, now);
      }
      throw error;
    }
  }

  /**
   * Deletes the scope's Pilote's tokens, unless they are no longer `read`
   * (the refresh token as read, encrypted with a random nonce): a sign-in
   * stored new ones meanwhile, which are read again. A Pilote with another
   * Identité keeps their sessions: `pilot.upserted` tells their tabs to
   * reconnect GitHub, 409 `github.not-linked`. One whose only Identité is
   * GitHub is signed out: the token's delete is conditional and takes its
   * row's lock, the sessions are deleted only after it in the same
   * transaction, so a sign-in that commits first keeps its session, one that
   * commits after waits. The sockets of the sessions deleted, and of those
   * only, are closed once it commits: a sign-in that completes between the
   * commit and the return keeps its socket.
   */
  private async expire(read: Uint8Array<ArrayBuffer>, pilotId: string, now: number): Promise<GithubToken> {
    const outcome = await this.transactions.run(async (tx) => {
      const { count } = await tx.githubUserToken.deleteMany({ where: { refreshTokenEnc: { equals: read } } });
      if (count === 0) return 'read-again' as const;
      if ((await tx.pilotIdentity.count({ where: { provider: { not: 'github' } } })) > 0) {
        await publishMe(tx, this.events, pilotId);
        return 'kept' as const;
      }
      return this.sessions.deleteAll(tx);
    });
    if (outcome === 'read-again') return this.read(pilotId, now);
    if (outcome === 'kept') throw githubNotLinked();
    this.sessions.revokeSockets(pilotId, outcome);
    throw githubExpired();
  }
}
