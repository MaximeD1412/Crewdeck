import { type Device, type Vault, type VaultItems, type VaultState, zDevice, zRevokeDevice, zVault, zVaultItems, zVaultRotation, zVaultState } from '@crewdeck/contracts';
import { Body, Controller, Get, HttpCode, Inject, Injectable, type OnModuleInit, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { createZodDto, ZodResponse } from 'nestjs-zod';
import { z } from 'zod';
import { type RunnerRequest, RunnerTokenGuard } from '../devices/runner-token.guard.js';
import { type TrustedDeviceRequest, TrustedDeviceGuard } from '../devices/trusted-device.guard.js';
import { STATE_CONTRIBUTORS, type StateContributor, type StateContributors } from '../realtime/state-contributors.js';
import type { Tx } from '../realtime/transactions.js';
import { Public } from '../scope/public.decorator.js';
import { currentPilotId } from '../scope/scope.context.js';
import { VaultService } from './vault.service.js';

export class RevokeDeviceDto extends createZodDto(zRevokeDevice) {}
export class RevokedDeviceDto extends createZodDto(zDevice) {}
export class VaultDto extends createZodDto(zVault) {}
export class VaultItemsDto extends createZodDto(zVaultItems) {}
export class VaultItemsQueryDto extends createZodDto(z.object({ cursor: z.string().min(1).max(200).optional() })) {}
export class VaultRotationDto extends createZodDto(zVaultRotation) {}
export class VaultStateDto extends createZodDto(zVaultState) {}

/** `POST /api/devices/:id/revoke` (E2E-4): the Pilote removes an Appareil, « Paramètres », « Appareils », « Retirer ». */
@Controller('devices')
export class DeviceRevocationController {
  constructor(private readonly vault: VaultService) {}

  @Post(':id/revoke')
  @HttpCode(200)
  @ZodResponse({ status: 200, description: 'The Appareil, revoked; the rotation of the vault key pending when it held it.', type: RevokedDeviceDto })
  revoke(@Param('id') id: string, @Body() body: RevokeDeviceDto): Promise<Device> {
    return this.vault.revokeDevice(currentPilotId(), id, body);
  }
}

/** The vault for a trusted Appareil (`X-Crewdeck-Device`): its holders, its item keys, its rotation. */
@UseGuards(TrustedDeviceGuard)
@Controller('vault')
export class VaultController {
  constructor(private readonly vault: VaultService) {}

  @Get()
  @ZodResponse({ status: 200, description: 'The vault’s version, whether a rotation waits, its holders and the seq a rotation carries.', type: VaultDto })
  get(): Promise<Vault> {
    return this.vault.vault(currentPilotId());
  }

  @Get('items')
  @ZodResponse({ status: 200, description: 'A page of the item keys under the vault key.', type: VaultItemsDto })
  items(@Query() query: VaultItemsQueryDto): Promise<VaultItems> {
    return this.vault.items(query.cursor);
  }

  @Post('rotations')
  @HttpCode(200)
  @ZodResponse({ status: 200, description: 'The vault after its rotation.', type: VaultStateDto })
  rotate(@Req() request: TrustedDeviceRequest, @Body() body: VaultRotationDto): Promise<VaultState> {
    return this.vault.rotate(currentPilotId(), { type: 'device', id: request.trustedDeviceId ?? '' }, body);
  }
}

/** The same for the Runner, with its token. */
@Public()
@UseGuards(RunnerTokenGuard)
@Controller('runner/vault')
export class RunnerVaultController {
  constructor(private readonly vault: VaultService) {}

  @Get()
  @ZodResponse({ status: 200, description: 'The vault’s version, whether a rotation waits, its holders and the seq a rotation carries.', type: VaultDto })
  get(): Promise<Vault> {
    return this.vault.vault(currentPilotId());
  }

  @Get('items')
  @ZodResponse({ status: 200, description: 'A page of the item keys under the vault key.', type: VaultItemsDto })
  items(@Query() query: VaultItemsQueryDto): Promise<VaultItems> {
    return this.vault.items(query.cursor);
  }

  @Post('rotations')
  @HttpCode(200)
  @ZodResponse({ status: 200, description: 'The vault after its rotation.', type: VaultStateDto })
  rotate(@Req() request: RunnerRequest, @Body() body: VaultRotationDto): Promise<VaultState> {
    return this.vault.rotate(currentPilotId(), { type: 'runner', id: request.runnerId ?? '' }, body);
  }
}

/** The `vault` slice of `GET /api/state`: its version and whether a rotation waits. */
@Injectable()
export class VaultStateContributor implements StateContributor<'vault'>, OnModuleInit {
  readonly key = 'vault';

  constructor(
    @Inject(STATE_CONTRIBUTORS) private readonly contributors: StateContributors,
    private readonly vault: VaultService,
  ) {}

  onModuleInit(): void {
    this.contributors.add(this);
  }

  snapshot(tx: Tx, pilotId: string): Promise<VaultState> {
    return this.vault.state(tx, pilotId);
  }
}
