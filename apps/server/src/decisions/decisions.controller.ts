import { type Decision, type DecisionList, zDecisionList, zDecisionListQuery } from '@crewdeck/contracts';
import { Controller, Get, Inject, Injectable, type OnModuleInit, Query } from '@nestjs/common';
import { createZodDto, ZodResponse } from 'nestjs-zod';
import { AppError } from '../errors/app-error.js';
import { MESSAGES } from '../errors/messages.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { STATE_CONTRIBUTORS, type StateContributor, type StateContributors } from '../realtime/state-contributors.js';
import type { Tx } from '../realtime/transactions.js';
import { decodeDecisionCursor, encodeDecisionCursor } from './decision-cursor.js';
import { DECISION_VIEW, toDecision } from './decision.view.js';

export class DecisionListQueryDto extends createZodDto(zDecisionListQuery) {}
export class DecisionListDto extends createZodDto(zDecisionList) {}

/** A page of the resolved Décisions (ADR 0008, « Lists »). */
export const RESOLVED_PAGE = 50;

const NEWEST_FIRST = [{ createdAt: 'desc' }, { id: 'desc' }] as const;

/** `GET /api/decisions`: the Pilote's open Décisions, every one, or their resolved ones, a page at a time. */
@Controller('decisions')
export class DecisionsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ZodResponse({ status: 200, description: 'The Pilote’s Décisions, open or resolved, newest first.', type: DecisionListDto })
  async list(@Query() { state, projectId, cursor }: DecisionListQueryDto): Promise<DecisionList> {
    const where = { state, ...(projectId ? { projectId } : {}) };
    if (state === 'open') {
      const rows = await this.prisma.scoped.decision.findMany({ where, orderBy: [...NEWEST_FIRST], select: DECISION_VIEW });
      return { items: rows.map(toDecision), nextCursor: null };
    }
    const after = cursor === undefined ? undefined : decodeDecisionCursor(cursor);
    if (cursor !== undefined && !after) {
      throw new AppError(400, 'validation.invalid', MESSAGES['validation.invalid'], { cursor: MESSAGES['decision.cursor-invalid'] });
    }
    const rows = await this.prisma.scoped.decision.findMany({
      where: after
        ? { ...where, OR: [{ createdAt: { lt: after.createdAt } }, { createdAt: after.createdAt, id: { lt: after.id } }] }
        : where,
      orderBy: [...NEWEST_FIRST],
      take: RESOLVED_PAGE + 1,
      select: DECISION_VIEW,
    });
    const page = rows.slice(0, RESOLVED_PAGE);
    const last = page.at(-1);
    return { items: page.map(toDecision), nextCursor: rows.length > RESOLVED_PAGE && last ? encodeDecisionCursor(last) : null };
  }
}

/** The `decisions` slice of `GET /api/state`: the open Décisions, every one, newest first. */
@Injectable()
export class DecisionsState implements StateContributor<'decisions'>, OnModuleInit {
  readonly key = 'decisions';

  constructor(@Inject(STATE_CONTRIBUTORS) private readonly contributors: StateContributors) {}

  onModuleInit(): void {
    this.contributors.add(this);
  }

  async snapshot(tx: Tx): Promise<Decision[]> {
    const rows = await tx.decision.findMany({ where: { state: 'open' }, orderBy: [...NEWEST_FIRST], select: DECISION_VIEW });
    return rows.map(toDecision);
  }
}
