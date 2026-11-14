import { type UsageAccount, type UsageList, zUsageList } from '@crewdeck/contracts';
import { Controller, Get, Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { createZodDto, ZodResponse } from 'nestjs-zod';
import { PrismaService } from '../prisma/prisma.service.js';
import { STATE_CONTRIBUTORS, type StateContributor, type StateContributors } from '../realtime/state-contributors.js';
import type { Tx } from '../realtime/transactions.js';
import { RunnerClock } from '../runners/clock.js';
import { currentPilotId } from '../scope/scope.context.js';
import { listUsage } from './usage.view.js';

export class UsageListDto extends createZodDto(zUsageList) {}

/** `GET /api/usage`: the usage of the Pilote's Comptes IA that have one. */
@Controller('usage')
export class UsageController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: RunnerClock,
  ) {}

  @Get()
  @ZodResponse({ status: 200, description: 'The usage of the Pilote’s Comptes IA against their limits, and the month’s estimated spend of an API key.', type: UsageListDto })
  async list(): Promise<UsageList> {
    return { accounts: await listUsage(this.prisma.scoped, currentPilotId(), this.clock.now()) };
  }
}

/** The `usage` slice of `GET /api/state`: the same list. */
@Injectable()
export class UsageState implements StateContributor<'usage'>, OnModuleInit {
  readonly key = 'usage';

  constructor(
    @Inject(STATE_CONTRIBUTORS) private readonly contributors: StateContributors,
    private readonly clock: RunnerClock,
  ) {}

  onModuleInit(): void {
    this.contributors.add(this);
  }

  snapshot(tx: Tx): Promise<UsageAccount[]> {
    return listUsage(tx, currentPilotId(), this.clock.now());
  }
}
