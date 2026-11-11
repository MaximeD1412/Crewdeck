import { STATE_SLICES, type State, type StateKey, zState } from '@crewdeck/contracts';
import { Controller, Get, Inject, type OnApplicationBootstrap } from '@nestjs/common';
import { createZodDto, ZodResponse } from 'nestjs-zod';
import { AppError } from '../errors/app-error.js';
import { MESSAGES } from '../errors/messages.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { currentPilotId } from '../scope/scope.context.js';
import { STATE_CONTRIBUTORS, type StateContributors } from './state-contributors.js';

export class StateDto extends createZodDto(zState) {}

/**
 * `GET /api/state` (ADR 0007): the snapshot a page loads first, or after
 * `snapshot-required`, then sends `hello` with its `seq`. The Pilote's `seq`
 * and every slice are read in one `REPEATABLE READ` transaction: the snapshot
 * is exactly the state after event `seq`.
 */
@Controller('state')
export class StateController implements OnApplicationBootstrap {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(STATE_CONTRIBUTORS) private readonly contributors: StateContributors,
  ) {}

  /** Every slice of `STATE_SLICES` has its contributor, and only one: else the app does not start. */
  onApplicationBootstrap(): void {
    const keys = this.contributors.all().map((contributor) => contributor.key);
    const expected = Object.keys(STATE_SLICES) as StateKey[];
    const missing = expected.filter((key) => !keys.includes(key));
    const extra = keys.filter((key, index) => !expected.includes(key) || keys.indexOf(key) !== index);
    if (missing.length > 0 || extra.length > 0) {
      throw new Error(`STATE_CONTRIBUTORS does not match STATE_SLICES: missing [${missing.join(', ')}], unexpected or repeated [${extra.join(', ')}]`);
    }
  }

  @Get()
  @ZodResponse({ status: 200, description: 'The state of the signed-in Pilote, and the seq of the last event it reflects.', type: StateDto })
  state(): Promise<State> {
    const pilotId = currentPilotId();
    return this.prisma.scoped.$transaction(
      async (tx) => {
        const pilot = await tx.pilot.findUnique({ where: { id: pilotId }, select: { seq: true } });
        if (!pilot) throw new AppError(401, 'auth.required', MESSAGES['auth.required']);
        const slices: Partial<Record<StateKey, unknown>> = {};
        // One after the other: a transaction's client runs one query at a time.
        for (const contributor of this.contributors.all()) slices[contributor.key] = await contributor.snapshot(tx, pilotId);
        return { seq: Number(pilot.seq), ...slices } as State;
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
}
