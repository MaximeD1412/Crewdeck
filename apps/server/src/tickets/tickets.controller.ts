import { type TicketDetail, type TicketList, TICKETS_PAGE, zId, zTicketDetail, zTicketList, zTicketListQuery, zTicketNumber } from '@crewdeck/contracts';
import { Controller, Get, Param, Query } from '@nestjs/common';
import { createZodDto, ZodResponse } from 'nestjs-zod';
import { AppError, notFound } from '../errors/app-error.js';
import { MESSAGES } from '../errors/messages.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CHECK_VIEW, CODE_CHANGE_VIEW, TICKET_VIEW, toCheck, toCodeChange, toTicket } from './ticket.view.js';

export class TicketListQueryDto extends createZodDto(zTicketListQuery) {}
export class TicketListDto extends createZodDto(zTicketList) {}
export class TicketDetailDto extends createZodDto(zTicketDetail) {}

const projectNotFound = (): AppError => notFound('project.not-found', MESSAGES['project.not-found']);
const ticketNotFound = (): AppError => notFound('ticket.not-found', MESSAGES['ticket.not-found']);

/** The cursor the page sends back as is: base64url of the last number of the page. */
export const encodeTicketCursor = (number: number): string => Buffer.from(String(number)).toString('base64url');
export const decodeTicketCursor = (cursor: string): number | undefined => {
  const parsed = zTicketNumber.safeParse(Buffer.from(cursor, 'base64url').toString('utf8'));
  return parsed.success && encodeTicketCursor(parsed.data) === cursor ? parsed.data : undefined;
};

/** `GET /api/projects/:id/tickets` and `GET /api/projects/:id/tickets/:number`: a Projet's Tickets, whatever their Source. */
@Controller('projects/:id/tickets')
export class TicketsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ZodResponse({ status: 200, description: 'The Projet’s Tickets, by number descending, 50 per page.', type: TicketListDto })
  async list(@Param('id') id: string, @Query() { state, cursor }: TicketListQueryDto): Promise<TicketList> {
    const projectId = await this.project(id);
    const after = cursor === undefined ? undefined : decodeTicketCursor(cursor);
    if (cursor !== undefined && after === undefined) {
      throw new AppError(400, 'validation.invalid', MESSAGES['validation.invalid'], { cursor: MESSAGES['ticket.cursor-invalid'] });
    }
    const rows = await this.prisma.scoped.ticket.findMany({
      where: { projectId, ...(state ? { state } : {}), ...(after === undefined ? {} : { number: { lt: after } }) },
      orderBy: { number: 'desc' },
      take: TICKETS_PAGE + 1,
      select: TICKET_VIEW,
    });
    const page = rows.slice(0, TICKETS_PAGE);
    const last = page.at(-1);
    return { items: page.map(toTicket), nextCursor: rows.length > TICKETS_PAGE && last ? encodeTicketCursor(last.number) : null };
  }

  @Get(':number')
  @ZodResponse({ status: 200, description: 'A Ticket, its changes of code (newest first) and the checks of the latest one’s head.', type: TicketDetailDto })
  async detail(@Param('id') id: string, @Param('number') number: string): Promise<TicketDetail> {
    const projectId = await this.project(id);
    const parsed = zTicketNumber.safeParse(number);
    if (!parsed.success) throw ticketNotFound();
    const row = await this.prisma.scoped.ticket.findFirst({ where: { projectId, number: parsed.data }, select: TICKET_VIEW });
    if (!row) throw ticketNotFound();
    const changes = await this.prisma.scoped.codeChange.findMany({ where: { projectId, ticketNumber: parsed.data }, orderBy: { number: 'desc' }, select: CODE_CHANGE_VIEW });
    const latest = changes[0];
    const checks =
      latest?.headSha
        ? await this.prisma.scoped.codeChangeCheck.findMany({ where: { codeChangeId: latest.id, sha: latest.headSha }, orderBy: { name: 'asc' }, select: CHECK_VIEW })
        : [];
    return { ticket: toTicket(row), codeChanges: changes.map(toCodeChange), checks: checks.map(toCheck) };
  }

  /** The Projet's id, 404 for one unknown or another Pilote's. */
  private async project(id: string): Promise<string> {
    const parsed = zId.safeParse(id);
    if (!parsed.success) throw projectNotFound();
    if ((await this.prisma.scoped.project.count({ where: { id: parsed.data } })) === 0) throw projectNotFound();
    return parsed.data;
  }
}
