import { DEVICE_HEADER, type Device, type DeviceList, type VaultKeyWrap, zDeviceList, zVaultKeyWrap } from '@crewdeck/contracts';
import { type CallHandler, Controller, type ExecutionContext, Get, Inject, Injectable, type NestInterceptor, type OnModuleInit, Param, Req } from '@nestjs/common';
import { createZodDto, ZodResponse } from 'nestjs-zod';
import { from, type Observable, switchMap } from 'rxjs';
import { type AuthRequest, headerOf } from '../auth/auth.request.js';
import { STATE_CONTRIBUTORS, type StateContributor, type StateContributors } from '../realtime/state-contributors.js';
import type { Tx } from '../realtime/transactions.js';
import { deviceIdOf, Devices } from './devices.service.js';

export class DeviceListDto extends createZodDto(zDeviceList) {}
export class VaultKeyWrapDto extends createZodDto(zVaultKeyWrap) {}

/** The Appareil the page named in `X-Crewdeck-Device`. */
export const namedDevice = (request: AuthRequest): string | undefined => deviceIdOf(headerOf(request, DEVICE_HEADER.toLowerCase()));

/** `GET /api/devices`, `GET /api/devices/:id/vault-key-wrap` (E2E-2). */
@Controller('devices')
export class DevicesController {
  constructor(private readonly devices: Devices) {}

  @Get()
  @ZodResponse({ status: 200, description: 'The Pilote’s Appareils, newest first, `current` the one of this page.', type: DeviceListDto })
  async list(@Req() request: AuthRequest): Promise<DeviceList> {
    return { items: await this.devices.list(namedDevice(request)) };
  }

  @Get(':id/vault-key-wrap')
  @ZodResponse({ status: 200, description: 'The Appareil’s wrap of the current vault key.', type: VaultKeyWrapDto })
  vaultKeyWrap(@Param('id') id: string): Promise<VaultKeyWrap> {
    return this.devices.vaultKeyWrap(id);
  }
}

/** The `devices` slice of `GET /api/state`: every Appareil, none `current` (each page knows its own). */
@Injectable()
export class DevicesState implements StateContributor<'devices'>, OnModuleInit {
  readonly key = 'devices';

  constructor(
    @Inject(STATE_CONTRIBUTORS) private readonly contributors: StateContributors,
    private readonly devices: Devices,
  ) {}

  onModuleInit(): void {
    this.contributors.add(this);
  }

  snapshot(tx: Tx): Promise<Device[]> {
    return this.devices.snapshot(tx);
  }
}

/**
 * A Pilote's request that names its Appareil moves its `lastSeenAt`, at most
 * once an hour, before the handler runs.
 */
@Injectable()
export class DeviceSeenInterceptor implements NestInterceptor {
  constructor(private readonly devices: Devices) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<AuthRequest>();
    const id = request.principal?.kind === 'pilot' ? namedDevice(request) : undefined;
    if (!request.principal || !id) return next.handle();
    const { pilotId } = request.principal;
    return from(this.devices.seen(pilotId, id)).pipe(switchMap(() => next.handle()));
  }
}
