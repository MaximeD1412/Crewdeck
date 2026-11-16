import { type AccountSettings, withSeq, zCreateRole } from '@crewdeck/contracts';
import { Body, Controller, Delete, HttpCode, Param, Post } from '@nestjs/common';
import { createZodDto, ZodResponse } from 'nestjs-zod';
import { Transactions } from '../realtime/transactions.js';
import { currentPilotId } from '../scope/scope.context.js';
import { RolesService } from './roles.js';
import { AccountSettingsDto } from './settings.controller.js';

/** No 409 on it: adding a Rôle changes the set, whatever the page last saw. */
export class CreateRoleDto extends createZodDto(withSeq(zCreateRole)) {}

/** `POST` and `DELETE /api/roles`: the Rôles the Pilote adds (PARAM-2); both answer the whole Paramètres. */
@Controller('roles')
export class RolesController {
  constructor(
    private readonly roles: RolesService,
    private readonly transactions: Transactions,
  ) {}

  @Post()
  @HttpCode(201)
  @ZodResponse({ status: 201, description: 'The Paramètres of the account, with the new Rôle.', type: AccountSettingsDto })
  create(@Body() { name, engine, model }: CreateRoleDto): Promise<AccountSettings> {
    const pilotId = currentPilotId();
    return this.transactions.run((tx) => this.roles.create(tx, pilotId, { name, engine, model }));
  }

  @Delete(':id')
  @HttpCode(200)
  @ZodResponse({ status: 200, description: 'The Paramètres of the account, without the Rôle.', type: AccountSettingsDto })
  remove(@Param('id') id: string): Promise<AccountSettings> {
    const pilotId = currentPilotId();
    return this.transactions.run((tx) => this.roles.remove(tx, pilotId, id));
  }
}
