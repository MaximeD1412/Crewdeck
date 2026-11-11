import { type Decision, zDecision, zTestingDecisionRaise, zTestingDecisionResolve } from '@crewdeck/contracts';
import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { createZodDto, ZodResponse } from 'nestjs-zod';
import { DecisionsService } from '../decisions/decisions.service.js';
import { Transactions } from '../realtime/transactions.js';

export class TestingDecisionRaiseDto extends createZodDto(zTestingDecisionRaise) {}
export class TestingDecisionResolveDto extends createZodDto(zTestingDecisionResolve) {}
export class TestingDecisionDto extends createZodDto(zDecision) {}

/**
 * `POST /api/testing/decisions` and `/resolve`: raises and resolves a
 * Décision of the Pilote signed in through `DecisionsService`, in one
 * transaction with its event, as its module would (ADR 0007). No module
 * raises one yet: the end-to-end tests of « À toi » see it come and go with
 * these. Mounted outside production only (`TestingModule`), behind the
 * session like any route.
 */
@Controller('testing/decisions')
export class TestingDecisionsController {
  constructor(
    private readonly transactions: Transactions,
    private readonly decisions: DecisionsService,
  ) {}

  @Post()
  @HttpCode(200)
  @ZodResponse({ status: 200, description: 'The Décision raised.', type: TestingDecisionDto })
  async raise(@Body() body: TestingDecisionRaiseDto): Promise<Decision> {
    return this.transactions.run(async (tx) => (await this.decisions.raise(tx, body)).decision);
  }

  @Post('resolve')
  @HttpCode(204)
  async resolve(@Body() { kind, subjectId, outcome }: TestingDecisionResolveDto): Promise<void> {
    await this.transactions.run((tx) => this.decisions.resolve(tx, kind, subjectId, outcome));
  }
}
