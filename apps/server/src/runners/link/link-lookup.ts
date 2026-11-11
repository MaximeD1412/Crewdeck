import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';

/** A code and its Pilote: what a route without a session needs to open the Pilote's scope. */
export interface LinkCodeOwner {
  readonly id: string;
  readonly pilotId: string;
}

/**
 * The link codes looked up across Pilotes (ADR 0008), with `prisma.unscoped`
 * (ESLint allows this file): the binary and `install.sh` call without a
 * session, the sweep sees every Pilote. Only the id and the Pilote are read
 * here; every change runs in the Pilote's scope (`RunnerLinks`).
 */
@Injectable()
export class RunnerLinkLookup {
  constructor(private readonly prisma: PrismaService) {}

  /** The code of `shortId`: the live one (`waiting` or `pending`, unique), else the last one that had it. */
  async byShortId(shortId: string): Promise<LinkCodeOwner | null> {
    const live = await this.prisma.unscoped.runnerLinkCode.findFirst({
      where: { shortId, state: { in: ['waiting', 'pending'] } },
      select: { id: true, pilotId: true },
    });
    return (
      live ??
      this.prisma.unscoped.runnerLinkCode.findFirst({ where: { shortId }, orderBy: { createdAt: 'desc' }, select: { id: true, pilotId: true } })
    );
  }

  async byId(id: string): Promise<LinkCodeOwner | null> {
    return this.prisma.unscoped.runnerLinkCode.findUnique({ where: { id }, select: { id: true, pilotId: true } });
  }

  /** The live codes whose 10 minutes are over at `now`. */
  async expiredAt(now: Date): Promise<LinkCodeOwner[]> {
    return this.prisma.unscoped.runnerLinkCode.findMany({
      where: { state: { in: ['waiting', 'pending'] }, expiresAt: { lte: now } },
      select: { id: true, pilotId: true },
    });
  }
}
