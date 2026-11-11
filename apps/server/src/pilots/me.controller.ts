import { type GettingStartedStep, type Me, nextGettingStartedStep, zGettingStartedAdvance, zMe } from '@crewdeck/contracts';
import { Body, Controller, Get, HttpCode, Inject, Injectable, Module, type OnModuleInit, Post } from '@nestjs/common';
import { createZodDto, ZodResponse } from 'nestjs-zod';
import { AppError, conflict, unprocessable } from '../errors/app-error.js';
import { MESSAGES } from '../errors/messages.js';
import type { GettingStartedStep as GettingStartedStepRow } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { EventsWriter } from '../realtime/events.writer.js';
import { assertFresh } from '../realtime/freshness.js';
import { STATE_CONTRIBUTORS, type StateContributor, type StateContributors } from '../realtime/state-contributors.js';
import { Transactions, type Tx } from '../realtime/transactions.js';
import { currentPilotId } from '../scope/scope.context.js';

export class MeDto extends createZodDto(zMe) {}
export class GettingStartedAdvanceDto extends createZodDto(zGettingStartedAdvance) {}

/** What of the Pilote's row the page sees: `GET /api/me`, the `pilot` slice of `GET /api/state`, the payload of `pilot.upserted`. */
export const ME = { id: true, login: true, avatarUrl: true, timeZone: true, gettingStartedStep: true } as const;

type MeRow = Omit<Me, 'gettingStartedStep'> & { gettingStartedStep: GettingStartedStepRow };

/** The step as the contracts spell it (`ai-accounts`), Prisma's enum keeping `ai_accounts`. */
const stepOf = (row: GettingStartedStepRow): GettingStartedStep => (row === 'ai_accounts' ? 'ai-accounts' : row);
const rowOf = (step: GettingStartedStep): GettingStartedStepRow => (step === 'ai-accounts' ? 'ai_accounts' : step);

/** The Pilote's row, as the page reads it. */
export const toMe = (row: MeRow): Me => ({ ...row, gettingStartedStep: stepOf(row.gettingStartedStep) });

/**
 * `GET /api/me`: who is signed in, which the page asks first; and the
 * getting started (« Premiers pas »), one step after the other.
 */
@Controller('me')
export class MeController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transactions: Transactions,
    private readonly events: EventsWriter,
  ) {}

  @Get()
  @ZodResponse({ status: 200, description: 'The signed-in Pilote.', type: MeDto })
  async me(): Promise<Me> {
    const pilot = await this.prisma.scoped.pilot.findUnique({ where: { id: currentPilotId() }, select: ME });
    if (!pilot) throw new AppError(401, 'auth.required', MESSAGES['auth.required']);
    return toMe(pilot);
  }

  /**
   * `POST /api/me/getting-started/advance`: from the step the page shows to
   * the next. 409 when the Pilote is no longer at `from` (another tab moved
   * on), 422 from `runner` without a linked Runner. RUNNER-7 adds the rule
   * of `ai-accounts`.
   */
  @Post('getting-started/advance')
  @HttpCode(200)
  @ZodResponse({ status: 200, description: 'The Pilote at the next step.', type: MeDto })
  advance(@Body() { from, seq }: GettingStartedAdvanceDto): Promise<Me> {
    const pilotId = currentPilotId();
    return this.transactions.run(async (tx) => {
      const row = await tx.pilot.findUnique({ where: { id: pilotId }, select: { gettingStartedStep: true, lastSeq: true } });
      if (!row) throw new AppError(401, 'auth.required', MESSAGES['auth.required']);
      assertFresh(row.lastSeq, BigInt(seq));
      if (stepOf(row.gettingStartedStep) !== from) throw conflict('realtime.stale', MESSAGES['realtime.stale']);
      if (from === 'runner' && (await tx.runner.count({ where: { revokedAt: null } })) === 0) {
        throw unprocessable('getting-started.runner-not-linked', MESSAGES['getting-started.runner-not-linked']);
      }
      const pilot = toMe(await tx.pilot.update({ where: { id: pilotId }, data: { gettingStartedStep: rowOf(nextGettingStartedStep(from)) }, select: ME }));
      const written = await this.events.write(tx, pilotId, 'pilot.upserted', pilot);
      await tx.pilot.update({ where: { id: pilotId }, data: { lastSeq: written } });
      return pilot;
    });
  }
}

/** The `pilot` slice of `GET /api/state`. */
@Injectable()
export class PilotState implements StateContributor<'pilot'>, OnModuleInit {
  readonly key = 'pilot';

  constructor(@Inject(STATE_CONTRIBUTORS) private readonly contributors: StateContributors) {}

  onModuleInit(): void {
    this.contributors.add(this);
  }

  async snapshot(tx: Tx, pilotId: string): Promise<Me> {
    const pilot = await tx.pilot.findUnique({ where: { id: pilotId }, select: ME });
    if (!pilot) throw new AppError(401, 'auth.required', MESSAGES['auth.required']);
    return toMe(pilot);
  }
}

@Module({ controllers: [MeController], providers: [PilotState] })
export class PilotsModule {}
