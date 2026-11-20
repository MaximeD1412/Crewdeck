import { IDEA_CLOSED_STATES, type Idea, type IdeaList, type ListIdeasQuery, type NoteIdeaInput } from '@crewdeck/contracts';
import { Injectable } from '@nestjs/common';
import { DecisionsService } from '../decisions/decisions.service.js';
import { AppError, conflict, notFound } from '../errors/app-error.js';
import { MESSAGES } from '../errors/messages.js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { EventsWriter } from '../realtime/events.writer.js';
import { assertFresh } from '../realtime/freshness.js';
import { Transactions, type Tx } from '../realtime/transactions.js';
import { assertVaultVersion } from '../vault/sealed-write.js';
import { IdeaAnalysis } from './analysis.js';
import { decodeIdeaCursor, encodeIdeaCursor } from './idea-cursor.js';
import { IDEA_VIEW, ideaStateRow, toIdea } from './idea.view.js';
import { syncIdeasToTriage } from './triage-decision.js';

/** A page of `GET /api/ideas` (ADR 0008, « Lists »). */
export const IDEAS_PAGE = 50;

/** The `ideas` slice keeps the merged and rejected Idées this long. */
export const CLOSED_KEPT_DAYS = 90;

const LAST_UPDATED_FIRST = [{ updatedAt: 'desc' }, { id: 'desc' }] as const;

const projectNotFound = (): AppError => notFound('project.not-found', MESSAGES['project.not-found']);
const idTaken = (): AppError => conflict('idea.id-taken', MESSAGES['idea.id-taken']);

/** The primary key refused the row: the id the page drew is already an Idée's. */
const isUniqueViolation = (error: unknown): boolean => error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';

/** The Pilote's Idées (scoped by `tx`) the `ideas` slice holds: every one not merged nor rejected, those for `CLOSED_KEPT_DAYS`. */
export const listIdeasHeld = async (tx: Pick<Tx, 'idea'>, now = new Date()): Promise<Idea[]> => {
  const since = new Date(now.getTime() - CLOSED_KEPT_DAYS * 24 * 60 * 60 * 1000);
  const closed = IDEA_CLOSED_STATES.map(ideaStateRow);
  const rows = await tx.idea.findMany({
    where: { OR: [{ state: { notIn: closed } }, { updatedAt: { gte: since } }] },
    orderBy: [{ number: 'desc' }],
    select: IDEA_VIEW,
  });
  return rows.map(toIdea);
};

/**
 * The Idées (US-5, IDEE-1). Noting one, in one transaction: its `#<n>` from
 * the Pilote's `ideaSeq`, the row `to-triage` with its sealed text as the
 * page sent it, `idea.upserted`, and the Décision `ideas-to-triage`
 * relabelled. The server never reads the text (ADR 0003).
 */
@Injectable()
export class IdeasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transactions: Transactions,
    private readonly events: EventsWriter,
    private readonly decisions: DecisionsService,
    private readonly analysis: IdeaAnalysis,
  ) {}

  /**
   * 404 `project.not-found` for a Projet unknown or another Pilote's, 409
   * `realtime.stale` when the chosen Projet changed since `seq`, 409
   * `idea.id-taken` for an id already an Idée's, 409 `vault.version-changed`
   * for a text sealed under another vault key than the current one. The
   * Idée then enters the `idea.noted` Phase of its Process (IDEE-2), its
   * analysis making it `analysing`; without one, it stays `to-triage`.
   */
  async note(pilotId: string, { id, text, vaultKeyVersion, projectId, notedFrom, dictated, seq }: NoteIdeaInput): Promise<Idea> {
    try {
      return await this.transactions.run(async (tx) => {
        if (projectId !== null) {
          const project = await tx.project.findUnique({ where: { id: projectId }, select: { lastSeq: true } });
          if (!project) throw projectNotFound();
          assertFresh(project.lastSeq, BigInt(seq));
        }
        const { ideaSeq } = await tx.pilot.update({ where: { id: pilotId }, data: { ideaSeq: { increment: 1 } }, select: { ideaSeq: true } });
        // The Pilote's row is now held: no rotation moves the vault before the commit.
        await assertVaultVersion(tx, pilotId, vaultKeyVersion);
        const now = new Date();
        const row = await tx.idea.create({
          data: { id, pilotId, number: ideaSeq, projectId, state: 'to_triage', text, notedFrom, dictated, createdAt: now, updatedAt: now },
          select: IDEA_VIEW,
        });
        await this.analysis.admit(tx, id, projectId);
        const admitted = await tx.idea.findUniqueOrThrow({ where: { id }, select: { ...IDEA_VIEW, lastSeq: true } });
        // Its analysis started wrote its `idea.upserted` already.
        if (admitted.lastSeq > 0n) return toIdea(admitted);
        const idea = toIdea(row);
        const ideaSeqOfEvent = await this.events.write(tx, pilotId, 'idea.upserted', idea);
        await tx.idea.update({ where: { id }, data: { lastSeq: ideaSeqOfEvent } });
        await syncIdeasToTriage(tx, pilotId, this.decisions);
        return idea;
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw idTaken();
      throw error;
    }
  }

  /** A page of the Pilote's Idées in `states`, the last updated first; 400 for a cursor it did not give. */
  async list({ states, cursor }: ListIdeasQuery): Promise<IdeaList> {
    const after = cursor === undefined ? undefined : decodeIdeaCursor(cursor);
    if (cursor !== undefined && !after) {
      throw new AppError(400, 'validation.invalid', MESSAGES['validation.invalid'], { cursor: MESSAGES['idea.cursor-invalid'] });
    }
    const where = { state: { in: [...new Set(states)].map(ideaStateRow) } };
    const rows = await this.prisma.scoped.idea.findMany({
      where: after ? { ...where, OR: [{ updatedAt: { lt: after.updatedAt } }, { updatedAt: after.updatedAt, id: { lt: after.id } }] } : where,
      orderBy: [...LAST_UPDATED_FIRST],
      take: IDEAS_PAGE + 1,
      select: IDEA_VIEW,
    });
    const page = rows.slice(0, IDEAS_PAGE);
    const last = page.at(-1);
    return { items: page.map(toIdea), nextCursor: rows.length > IDEAS_PAGE && last ? encodeIdeaCursor(last) : null };
  }
}
