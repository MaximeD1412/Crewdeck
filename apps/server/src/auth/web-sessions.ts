import { createHash, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { newId } from '../ids.js';
import { PrismaService, type ScopedPrisma } from '../prisma/prisma.service.js';

/** A session lasts 30 days from its last use. */
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
/** Its expiry slides at most once an hour: one write per hour of use, not per request. */
const SLIDE_EVERY_MS = 60 * 60 * 1000;

const hashOf = (token: string): string => createHash('sha256').update(token).digest('hex');

/** A signed-in browser, as the middleware found it. */
export interface OpenSession {
  readonly id: string;
  readonly pilotId: string;
}

/**
 * The `WebSession`s (server side, so that a logout or an expired GitHub
 * sign-in ends them at once): the cookie holds a random token, the row its
 * SHA-256 only.
 */
@Injectable()
export class WebSessions {
  constructor(private readonly prisma: PrismaService) {}

  /** A new session of `pilotId`, the scope's Pilote, written by `tx`; the token its cookie holds. */
  async open(tx: Pick<ScopedPrisma, 'webSession'>, pilotId: string, userAgent: string | undefined, now = new Date()): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    await tx.webSession.create({
      data: {
        id: newId(),
        pilotId,
        tokenHash: hashOf(token),
        lastSeenAt: now,
        expiresAt: new Date(now.getTime() + SESSION_TTL_SECONDS * 1000),
        userAgent: userAgent?.slice(0, 512) ?? null,
      },
    });
    return token;
  }

  /**
   * The open session of `token`, sliding its expiry: unscoped, the only lookup
   * made before a scope exists (it is what gives the request its Pilote).
   */
  async find(token: string, now = new Date()): Promise<OpenSession | undefined> {
    const session = await this.prisma.unscoped.webSession.findUnique({
      where: { tokenHash: hashOf(token) },
      select: { id: true, pilotId: true, lastSeenAt: true, expiresAt: true },
    });
    if (!session || session.expiresAt <= now) return undefined;
    if (now.getTime() - session.lastSeenAt.getTime() >= SLIDE_EVERY_MS) {
      await this.prisma.unscoped.webSession.updateMany({
        where: { id: session.id },
        data: { lastSeenAt: now, expiresAt: new Date(now.getTime() + SESSION_TTL_SECONDS * 1000) },
      });
    }
    return { id: session.id, pilotId: session.pilotId };
  }

  /** Ends one session of the scope's Pilote. */
  async close(id: string): Promise<void> {
    await this.prisma.scoped.webSession.deleteMany({ where: { id } });
  }

  /** Ends every session of the scope's Pilote. */
  async closeAll(): Promise<void> {
    await this.prisma.scoped.webSession.deleteMany({});
  }
}
