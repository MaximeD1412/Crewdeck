import {
  DEVICE_HEADER,
  type Device,
  type DeviceApproval,
  type DeviceCreated,
  type DeviceList,
  type PendingDevice,
  type VaultKeyWrap,
  zApproveDevice,
  zDevice,
  zDeviceApproval,
  zDeviceCreated,
  zDeviceList,
  zNewDeviceRequest,
  zPendingDevice,
  zVaultKeyWrap,
} from '@crewdeck/contracts';
import {
  Body,
  type CallHandler,
  Controller,
  type ExecutionContext,
  Get,
  HttpCode,
  Inject,
  Injectable,
  type NestInterceptor,
  type OnModuleInit,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { createZodDto, ZodResponse } from 'nestjs-zod';
import { from, type Observable, switchMap } from 'rxjs';
import { type AuthRequest, headerOf } from '../auth/auth.request.js';
import { STATE_CONTRIBUTORS, type StateContributor, type StateContributors } from '../realtime/state-contributors.js';
import type { Tx } from '../realtime/transactions.js';
import { currentPilotId } from '../scope/scope.context.js';
import { Public } from '../scope/public.decorator.js';
import { DeviceApprovals } from './device-approvals.service.js';
import { deviceIdOf, Devices } from './devices.service.js';
import { type RunnerRequest, RunnerTokenGuard } from './runner-token.guard.js';

export class DeviceListDto extends createZodDto(zDeviceList) {}
export class VaultKeyWrapDto extends createZodDto(zVaultKeyWrap) {}
export class NewDeviceRequestDto extends createZodDto(zNewDeviceRequest) {}
export class DeviceCreatedDto extends createZodDto(zDeviceCreated) {}
export class PendingDeviceDto extends createZodDto(zPendingDevice) {}
export class ApproveDeviceDto extends createZodDto(zApproveDevice) {}
export class DeviceDto extends createZodDto(zDevice) {}
export class DeviceApprovalDto extends createZodDto(zDeviceApproval) {}

/** The Appareil the page named in `X-Crewdeck-Device`. */
export const namedDevice = (request: AuthRequest): string | undefined => deviceIdOf(headerOf(request, DEVICE_HEADER.toLowerCase()));

/**
 * `GET /api/devices`, `GET /api/devices/:id/vault-key-wrap` (E2E-2); a new
 * Appareil's code and its approval by a trusted one (E2E-3).
 */
@Controller('devices')
export class DevicesController {
  constructor(
    private readonly devices: Devices,
    private readonly approvals: DeviceApprovals,
  ) {}

  @Post()
  @HttpCode(201)
  @ZodResponse({ status: 201, description: 'The new Appareil, pending, and its code’s short id (never its secret).', type: DeviceCreatedDto })
  register(@Body() body: NewDeviceRequestDto): Promise<DeviceCreated> {
    return this.approvals.register(currentPilotId(), body);
  }

  @Get('pending/:shortId')
  @ZodResponse({ status: 200, description: 'The Appareil whose code is live with this short id.', type: PendingDeviceDto })
  pending(@Param('shortId') shortId: string): Promise<PendingDevice> {
    return this.approvals.pending(shortId);
  }

  @Post(':id/approve')
  @HttpCode(200)
  @ZodResponse({ status: 200, description: 'The Appareil, trusted, approved by the page’s own.', type: DeviceDto })
  approve(@Req() request: AuthRequest, @Param('id') id: string, @Body() body: ApproveDeviceDto): Promise<Device> {
    return this.approvals.approve(currentPilotId(), id, { type: 'device', namedId: namedDevice(request) }, body);
  }

  @Get(':id/approval')
  @ZodResponse({ status: 200, description: 'Who approved the Appareil by its code, and their proof.', type: DeviceApprovalDto })
  approval(@Param('id') id: string): Promise<DeviceApproval> {
    return this.approvals.approval(id);
  }

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

/** `crewdeck-runner appareils approuver <code>` (E2E-3): the Runner reads a new Appareil and approves it, with its token. */
@Public()
@UseGuards(RunnerTokenGuard)
@Controller('runner/devices')
export class RunnerDevicesController {
  constructor(private readonly approvals: DeviceApprovals) {}

  @Get('pending/:shortId')
  @ZodResponse({ status: 200, description: 'The Appareil whose code is live with this short id.', type: PendingDeviceDto })
  pending(@Param('shortId') shortId: string): Promise<PendingDevice> {
    return this.approvals.pending(shortId);
  }

  @Post(':id/approve')
  @HttpCode(200)
  @ZodResponse({ status: 200, description: 'The Appareil, trusted, approved by the Runner.', type: DeviceDto })
  approve(@Req() request: RunnerRequest, @Param('id') id: string, @Body() body: ApproveDeviceDto): Promise<Device> {
    return this.approvals.approve(currentPilotId(), id, { type: 'runner', runnerId: request.runnerId ?? '' }, body);
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
