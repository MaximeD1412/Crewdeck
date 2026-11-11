import { createHash, randomBytes } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { headerOf } from './auth.request.js';

/** A new Runner token: 32 random bytes, base64url. The Runner keeps it (`runner.json`), the server only its hash. */
export const newRunnerToken = (): string => randomBytes(32).toString('base64url');

/** What `runners.token_hash` holds: the SHA-256 of the token, in hex. */
export const runnerTokenHash = (token: string): string => createHash('sha256').update(token).digest('hex');

/** The token of `Authorization: Bearer <token>`, `undefined` without one. */
export const bearerOf = (request: IncomingMessage): string | undefined => {
  const match = /^Bearer ([A-Za-z0-9_-]+)$/.exec(headerOf(request, 'authorization') ?? '');
  return match?.[1];
};

/** The Runner a token was given to, and whether a newer link revoked it. */
export interface RunnerCredential {
  readonly runnerId: string;
  readonly pilotId: string;
  readonly revoked: boolean;
}

/**
 * The Runners' tokens (ADR 0004): no expiry, a new link revokes the old
 * Runner's (RUNNER-3). Read before a scope exists, so unscoped, as the
 * session cookie's: the token is what gives the socket its Pilote.
 */
@Injectable()
export class RunnerTokens {
  constructor(private readonly prisma: PrismaService) {}

  /** The Runner of `token`, `undefined` when no Runner has it. */
  async find(token: string): Promise<RunnerCredential | undefined> {
    const runner = await this.prisma.unscoped.runner.findUnique({
      where: { tokenHash: runnerTokenHash(token) },
      select: { id: true, pilotId: true, revokedAt: true },
    });
    return runner ? { runnerId: runner.id, pilotId: runner.pilotId, revoked: runner.revokedAt !== null } : undefined;
  }
}
