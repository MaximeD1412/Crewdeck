import type { Event } from '@crewdeck/contracts';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { runInPilotScope } from '../scope/scope.context.js';
import { EVENT_VIEW, toEvent } from './events.writer.js';

/** What a socket's `hello` replays, read from the `events` the server still keeps. */
@Injectable()
export class EventsReplay {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Every event of `pilotId` after `lastSeq`, in order; `null` when the
   * server can no longer give them all: some deleted by the retention (a gap
   * before the oldest kept), or `lastSeq` ahead of the Pilote's `seq` (a page
   * of another database). The Pilote's `seq` and the events are read in one
   * snapshot (`REPEATABLE READ`).
   */
  after(pilotId: string, lastSeq: number): Promise<Event[] | null> {
    return runInPilotScope(pilotId, () =>
      this.prisma.scoped.$transaction(
        async (tx) => {
          const pilot = await tx.pilot.findUnique({ where: { id: pilotId }, select: { seq: true } });
          if (!pilot) return null;
          const current = Number(pilot.seq);
          if (lastSeq > current) return null;
          const rows = await tx.event.findMany({
            where: { seq: { gt: BigInt(lastSeq) } },
            orderBy: { seq: 'asc' },
            select: EVENT_VIEW,
          });
          // Contiguous from lastSeq + 1 to the Pilote's seq: a seq is never skipped, the retention deletes the oldest.
          if (rows.length !== current - lastSeq) return null;
          return rows.map(toEvent);
        },
        { isolationLevel: 'RepeatableRead' },
      ),
    );
  }
}
