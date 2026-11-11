import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { DeviceClock } from './device-clock.js';
import { DeviceSeenInterceptor, DevicesController, DevicesState } from './devices.controller.js';
import { Devices } from './devices.service.js';

/** The Pilote's Appareils and the wraps of the vault key (ADR 0003, E2E-2). */
@Module({
  controllers: [DevicesController],
  providers: [DeviceClock, Devices, DevicesState, { provide: APP_INTERCEPTOR, useClass: DeviceSeenInterceptor }],
  exports: [Devices, DeviceClock],
})
export class DevicesModule {}
