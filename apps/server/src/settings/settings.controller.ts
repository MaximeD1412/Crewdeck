import { type AccountSettings, withSeq, zAccountSettings, zAccountSettingsPatch } from '@crewdeck/contracts';
import { Body, Controller, Get, Inject, Injectable, type OnModuleInit, Patch } from '@nestjs/common';
import { createZodDto, ZodResponse } from 'nestjs-zod';
import { STATE_CONTRIBUTORS, type StateContributor, type StateContributors } from '../realtime/state-contributors.js';
import { type Tx, Transactions } from '../realtime/transactions.js';
import { currentPilotId } from '../scope/scope.context.js';
import { SettingsService } from './settings.service.js';

export class AccountSettingsDto extends createZodDto(zAccountSettings) {}
/** No 409 on it: a setting is a value, the last write wins. */
export class AccountSettingsPatchDto extends createZodDto(withSeq(zAccountSettingsPatch)) {}

/** `GET` and `PATCH /api/settings`: the Paramètres of the account. */
@Controller('settings')
export class SettingsController {
  constructor(
    private readonly settings: SettingsService,
    private readonly transactions: Transactions,
  ) {}

  @Get()
  @ZodResponse({ status: 200, description: 'The Paramètres of the account.', type: AccountSettingsDto })
  account(): Promise<AccountSettings> {
    return this.settings.account(currentPilotId());
  }

  @Patch()
  @ZodResponse({ status: 200, description: 'The Paramètres of the account, once changed.', type: AccountSettingsDto })
  update(@Body() body: AccountSettingsPatchDto): Promise<AccountSettings> {
    const pilotId = currentPilotId();
    // The `seq` the page carries is not read: the last change wins.
    return this.transactions.run((tx) => this.settings.update(tx, pilotId, body));
  }
}

/** The `settings` slice of `GET /api/state`. */
@Injectable()
export class SettingsState implements StateContributor<'settings'>, OnModuleInit {
  readonly key = 'settings';

  constructor(
    @Inject(STATE_CONTRIBUTORS) private readonly contributors: StateContributors,
    private readonly settings: SettingsService,
  ) {}

  onModuleInit(): void {
    this.contributors.add(this);
  }

  snapshot(tx: Tx, pilotId: string): Promise<AccountSettings> {
    return this.settings.account(pilotId, tx);
  }
}
