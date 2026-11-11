import { type Me, zMe, zTestingPilotUpdate } from '@crewdeck/contracts';
import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { createZodDto, ZodResponse } from 'nestjs-zod';
import { ME, toMe } from '../pilots/me.controller.js';
import { EventsWriter } from '../realtime/events.writer.js';
import { Transactions } from '../realtime/transactions.js';
import { currentPilotId } from '../scope/scope.context.js';

export class TestingPilotUpdateDto extends createZodDto(zTestingPilotUpdate) {}
export class TestingPilotDto extends createZodDto(zMe) {}

/**
 * `POST /api/testing/pilot` (body `{ login }`): renames the Pilote signed in,
 * with its `pilot.upserted` event in the same transaction, as a change of the
 * Process would (ADR 0007). No module writes an event yet: the end-to-end
 * tests make the page miss one with it. Mounted outside production only
 * (`TestingModule`), behind the session like any route.
 */
@Controller('testing/pilot')
export class TestingPilotController {
  constructor(
    private readonly transactions: Transactions,
    private readonly events: EventsWriter,
  ) {}

  @Post()
  @HttpCode(200)
  @ZodResponse({ status: 200, description: 'The Pilote renamed.', type: TestingPilotDto })
  async rename(@Body() { login }: TestingPilotUpdateDto): Promise<Me> {
    const pilotId = currentPilotId();
    return this.transactions.run(async (tx) => {
      const pilot = toMe(await tx.pilot.update({ where: { id: pilotId }, data: { login }, select: ME }));
      await this.events.write(tx, pilotId, 'pilot.upserted', pilot);
      return pilot;
    });
  }
}
