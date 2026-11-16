import { type PushSubscription, type PushSubscriptionList, zPushSubscription, zPushSubscriptionInput, zPushSubscriptionList } from '@crewdeck/contracts';
import { Body, Controller, Delete, Get, HttpCode, Inject, Injectable, type OnModuleInit, Param, Post } from '@nestjs/common';
import { createZodDto, ZodResponse } from 'nestjs-zod';
import { STATE_CONTRIBUTORS, type StateContributor, type StateContributors } from '../realtime/state-contributors.js';
import { Transactions, type Tx } from '../realtime/transactions.js';
import { currentPilotId } from '../scope/scope.context.js';
import { PushSubscriptions } from './push-subscriptions.js';

export class PushSubscriptionInputDto extends createZodDto(zPushSubscriptionInput) {}
export class PushSubscriptionDto extends createZodDto(zPushSubscription) {}
export class PushSubscriptionListDto extends createZodDto(zPushSubscriptionList) {}

/** `POST`, `GET` and `DELETE /api/push-subscriptions` (ATOI-4): the browsers that receive the Pilote's push notifications. */
@Controller('push-subscriptions')
export class PushSubscriptionsController {
  constructor(
    private readonly subscriptions: PushSubscriptions,
    private readonly transactions: Transactions,
  ) {}

  @Post()
  @HttpCode(201)
  @ZodResponse({
    status: 201,
    description: 'The browser’s subscription, its keys and label updated when it already was; 409 when another account has it, 422 past 20.',
    type: PushSubscriptionDto,
  })
  upsert(@Body() input: PushSubscriptionInputDto): Promise<PushSubscription> {
    const pilotId = currentPilotId();
    return this.transactions.run((tx) => this.subscriptions.upsert(tx, pilotId, input));
  }

  @Get()
  @ZodResponse({ status: 200, description: 'The Pilote’s subscriptions, newest first, at most 20.', type: PushSubscriptionListDto })
  async list(): Promise<PushSubscriptionList> {
    return { items: await this.transactions.run((tx) => this.subscriptions.list(tx)) };
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id') id: string): Promise<void> {
    const pilotId = currentPilotId();
    return this.transactions.run((tx) => this.subscriptions.remove(tx, pilotId, id));
  }
}

/** The `push-subscriptions` slice of `GET /api/state`. */
@Injectable()
export class PushSubscriptionsState implements StateContributor<'push-subscriptions'>, OnModuleInit {
  readonly key = 'push-subscriptions';

  constructor(
    @Inject(STATE_CONTRIBUTORS) private readonly contributors: StateContributors,
    private readonly subscriptions: PushSubscriptions,
  ) {}

  onModuleInit(): void {
    this.contributors.add(this);
  }

  snapshot(tx: Tx): Promise<PushSubscription[]> {
    return this.subscriptions.list(tx);
  }
}
