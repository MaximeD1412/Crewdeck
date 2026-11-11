import { type Me, zMe } from '@crewdeck/contracts';
import { Controller, Get, Inject, Injectable, Module, type OnModuleInit } from '@nestjs/common';
import { createZodDto, ZodResponse } from 'nestjs-zod';
import { AppError } from '../errors/app-error.js';
import { MESSAGES } from '../errors/messages.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { STATE_CONTRIBUTORS, type StateContributor, type StateContributors } from '../realtime/state-contributors.js';
import type { Tx } from '../realtime/transactions.js';
import { currentPilotId } from '../scope/scope.context.js';

export class MeDto extends createZodDto(zMe) {}

/** What of the Pilote's row the page sees: `GET /api/me`, the `pilot` slice of `GET /api/state`, the payload of `pilot.upserted`. */
export const ME = { id: true, login: true, avatarUrl: true, timeZone: true } as const;

/** `GET /api/me`: who is signed in, which the page asks first. */
@Controller('me')
export class MeController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ZodResponse({ status: 200, description: 'The signed-in Pilote.', type: MeDto })
  async me(): Promise<Me> {
    const pilot = await this.prisma.scoped.pilot.findUnique({ where: { id: currentPilotId() }, select: ME });
    if (!pilot) throw new AppError(401, 'auth.required', MESSAGES['auth.required']);
    return pilot;
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
    return pilot;
  }
}

@Module({ controllers: [MeController], providers: [PilotState] })
export class PilotsModule {}
