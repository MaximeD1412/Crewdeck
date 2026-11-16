import { type AgentSession, type AgentSessionList, zAgentSession, zAgentSessionList, zAgentSessionListQuery, zId, zSessionAction } from '@crewdeck/contracts';
import { Body, Controller, Get, HttpCode, Inject, Injectable, type OnModuleInit, Param, Post, Query } from '@nestjs/common';
import { createZodDto, ZodResponse } from 'nestjs-zod';
import { AppError, notFound } from '../errors/app-error.js';
import { MESSAGES } from '../errors/messages.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { STATE_CONTRIBUTORS, type StateContributor, type StateContributors } from '../realtime/state-contributors.js';
import type { Tx } from '../realtime/transactions.js';
import { decodeSessionCursor, encodeSessionCursor } from './session-cursor.js';
import { SESSION_ROW, toAgentSession } from './session.view.js';
import { SessionsService } from './sessions.service.js';

export class AgentSessionListQueryDto extends createZodDto(zAgentSessionListQuery) {}
export class AgentSessionListDto extends createZodDto(zAgentSessionList) {}
export class AgentSessionDto extends createZodDto(zAgentSession) {}
export class SessionActionDto extends createZodDto(zSessionAction) {}

/** A page of `GET /api/sessions` (ADR 0008, « Lists »). */
export const SESSIONS_PAGE = 50;

/** How long an ended Session stays in `GET /api/state`. */
export const RECENTLY_ENDED_HOURS = 24;

const NEWEST_FIRST = [{ startedAt: 'desc' }, { id: 'desc' }] as const;

const sessionId = (value: string): string => {
  const parsed = zId.safeParse(value);
  if (!parsed.success) throw notFound('sessions.not-found', MESSAGES['sessions.not-found']);
  return parsed.data;
};

/** `/api/sessions`: the Pilote's Sessions, newest first, one, and the Pilote's stop and resume (RUNNER-9). */
@Controller('sessions')
export class SessionsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionsService,
  ) {}

  @Get()
  @ZodResponse({ status: 200, description: 'The Pilote’s Sessions, newest first, a page at a time.', type: AgentSessionListDto })
  async list(@Query() { projectId, cursor }: AgentSessionListQueryDto): Promise<AgentSessionList> {
    const after = cursor === undefined ? undefined : decodeSessionCursor(cursor);
    if (cursor !== undefined && !after) {
      throw new AppError(400, 'validation.invalid', MESSAGES['validation.invalid'], { cursor: MESSAGES['sessions.cursor-invalid'] });
    }
    const where = projectId ? { projectId } : {};
    const rows = await this.prisma.scoped.agentSession.findMany({
      where: after ? { ...where, OR: [{ startedAt: { lt: after.startedAt } }, { startedAt: after.startedAt, id: { lt: after.id } }] } : where,
      orderBy: [...NEWEST_FIRST],
      take: SESSIONS_PAGE + 1,
      select: SESSION_ROW,
    });
    const page = rows.slice(0, SESSIONS_PAGE);
    const last = page.at(-1);
    return { items: page.map(toAgentSession), nextCursor: rows.length > SESSIONS_PAGE && last ? encodeSessionCursor(last) : null };
  }

  @Get(':id')
  @ZodResponse({ status: 200, description: 'One Session.', type: AgentSessionDto })
  async get(@Param('id') id: string): Promise<AgentSession> {
    const row = await this.prisma.scoped.agentSession.findUnique({ where: { id: sessionId(id) }, select: SESSION_ROW });
    if (!row) throw notFound('sessions.not-found', MESSAGES['sessions.not-found']);
    return toAgentSession(row);
  }

  @Post(':id/stop')
  @HttpCode(200)
  @ZodResponse({ status: 200, description: 'The Session, stopped.', type: AgentSessionDto })
  stop(@Param('id') id: string, @Body() { seq }: SessionActionDto): Promise<AgentSession> {
    return this.sessions.stop(sessionId(id), BigInt(seq));
  }

  @Post(':id/resume')
  @HttpCode(200)
  @ZodResponse({ status: 200, description: 'The Session, starting again.', type: AgentSessionDto })
  resume(@Param('id') id: string, @Body() { seq }: SessionActionDto): Promise<AgentSession> {
    return this.sessions.resume(sessionId(id), BigInt(seq));
  }
}

/** The `sessions` slice of `GET /api/state`: the Sessions not ended, and those ended in the last 24 h, newest first. */
@Injectable()
export class SessionsState implements StateContributor<'sessions'>, OnModuleInit {
  readonly key = 'sessions';

  constructor(@Inject(STATE_CONTRIBUTORS) private readonly contributors: StateContributors) {}

  onModuleInit(): void {
    this.contributors.add(this);
  }

  async snapshot(tx: Tx): Promise<AgentSession[]> {
    const since = new Date(Date.now() - RECENTLY_ENDED_HOURS * 60 * 60_000);
    const rows = await tx.agentSession.findMany({
      where: { OR: [{ state: { not: 'ended' } }, { endedAt: { gte: since } }] },
      orderBy: [...NEWEST_FIRST],
      select: SESSION_ROW,
    });
    return rows.map(toAgentSession);
  }
}
