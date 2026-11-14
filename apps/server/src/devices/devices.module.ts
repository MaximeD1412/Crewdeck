import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { DeviceClock } from './device-clock.js';
import { RunnerTokens } from '../auth/runner-tokens.js';
import { DeviceApprovals } from './device-approvals.service.js';
import { DeviceSeenInterceptor, DevicesController, DevicesState, RunnerDevicesController } from './devices.controller.js';
import { RunnerTokenGuard } from './runner-token.guard.js';
import { Devices } from './devices.service.js';

/** The Pilote's Appareils, the wraps of the vault key (ADR 0003, E2E-2) and a new Appareil's approval (E2E-3). */
@Module({
  controllers: [DevicesController, RunnerDevicesController],
  providers: [DeviceClock, Devices, DeviceApprovals, DevicesState, RunnerTokens, RunnerTokenGuard, { provide: APP_INTERCEPTOR, useClass: DeviceSeenInterceptor }],
  exports: [Devices, DeviceClock],
})
export class DevicesModule {}
