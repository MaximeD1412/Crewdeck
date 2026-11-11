import { type Runner, zRunner } from '@crewdeck/contracts';
import { Controller, Get, Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { createZodDto, ZodResponse } from 'nestjs-zod';
import { AppError } from '../errors/app-error.js';
import { MESSAGES } from '../errors/messages.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { STATE_CONTRIBUTORS, type StateContributor, type StateContributors } from '../realtime/state-contributors.js';
import type { Tx } from '../realtime/transactions.js';
import { RUNNER_VIEW, toRunner } from './runner.view.js';

export class RunnerDto extends createZodDto(zRunner) {}

/** The Pilote's current Runner: the one no newer link has revoked. */
const CURRENT = { revokedAt: null } as const;

/** `GET /api/runner`: the Pilote's Runner, its machine and whether it is « en ligne ». */
@Controller('runner')
export class RunnersController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ZodResponse({ status: 200, description: 'The Pilote’s current Runner.', type: RunnerDto })
  async current(): Promise<Runner> {
    const runner = await this.prisma.scoped.runner.findFirst({ where: CURRENT, select: RUNNER_VIEW });
    if (!runner) throw new AppError(404, 'runner.not-linked', MESSAGES['runner.not-linked']);
    return toRunner(runner);
  }
}

/** The `runner` slice of `GET /api/state`: the same object, `null` without a Runner. */
@Injectable()
export class RunnerState implements StateContributor<'runner'>, OnModuleInit {
  readonly key = 'runner';

  constructor(@Inject(STATE_CONTRIBUTORS) private readonly contributors: StateContributors) {}

  onModuleInit(): void {
    this.contributors.add(this);
  }

  async snapshot(tx: Tx): Promise<Runner | null> {
    const runner = await tx.runner.findFirst({ where: CURRENT, select: RUNNER_VIEW });
    return runner ? toRunner(runner) : null;
  }
}
