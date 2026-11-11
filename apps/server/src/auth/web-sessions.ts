import { createHash, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { newId } from '../ids.js';
import { PrismaService, type ScopedPrisma } from '../prisma/prisma.service.js';
import { WsRevocations } from '../realtime/ws-revocations.js';
import { currentPilotId } from '../scope/scope.context.js';

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

/** A session found by its cookie, its expiry, and whether it slid: the cookie then slides too. */
export interface FoundSession extends OpenSession {
  readonly expiresAt: Date;
  readonly slid: boolean;
}

/**
 * The `WebSession`s (server side, so that a logout or an expired GitHub
 * sign-in ends them at once, their sockets of `/api/ws` too): the cookie
 * holds a random token, the row its SHA-256 only.
 */
@Injectable()
export class WebSessions {
  constructor(
    private readonly prisma: PrismaService,
    private readonly revocations: WsRevocations,
  ) {}

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
  async find(token: string, now = new Date()): Promise<FoundSession | undefined> {
    const session = await this.prisma.unscoped.webSession.findUnique({
      where: { tokenHash: hashOf(token) },
      select: { id: true, pilotId: true, lastSeenAt: true, expiresAt: true },
    });
    if (!session || session.expiresAt <= now) return undefined;
    const slid = now.getTime() - session.lastSeenAt.getTime() >= SLIDE_EVERY_MS;
    let { expiresAt } = session;
    if (slid) {
      expiresAt = new Date(now.getTime() + SESSION_TTL_SECONDS * 1000);
      await this.prisma.unscoped.webSession.updateMany({ where: { id: session.id }, data: { lastSeenAt: now, expiresAt } });
    }
    return { id: session.id, pilotId: session.pilotId, expiresAt, slid };
  }

  /** When the session `id` expires now (slid by the requests meanwhile), `undefined` once it has ended; never slides it. */
  async expiryOf(id: string, now = new Date()): Promise<Date | undefined> {
    const session = await this.prisma.unscoped.webSession.findUnique({ where: { id }, select: { expiresAt: true } });
    return session && session.expiresAt > now ? session.expiresAt : undefined;
  }

  /** Ends one session of the scope's Pilote, and its sockets. */
  async close(id: string): Promise<void> {
    await this.prisma.scoped.webSession.deleteMany({ where: { id } });
    this.revokeSockets(currentPilotId(), [id]);
  }

  /** Ends every session of the scope's Pilote, and their sockets. */
  async closeAll(): Promise<void> {
    this.revokeSockets(currentPilotId(), await this.deleteAll(this.prisma.scoped));
  }

  /**
   * Deletes every session of the scope's Pilote within `tx`, and returns
   * their ids: a session opened after it is not among them, its sockets
   * stay open.
   */
  async deleteAll(tx: Pick<ScopedPrisma, 'webSession'>): Promise<string[]> {
    const ids = (await tx.webSession.findMany({ select: { id: true } })).map(({ id }) => id);
    if (ids.length > 0) await tx.webSession.deleteMany({ where: { id: { in: ids } } });
    return ids;
  }

  /** Ends the sockets of `pilotId`'s sessions `ids`, once the transaction that deleted them has committed. */
  revokeSockets(pilotId: string, ids: readonly string[]): void {
    this.revocations.revoke(pilotId, 'session', ids);
  }
}
