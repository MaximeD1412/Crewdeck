import { type Device, zDevice } from '../api/devices.js';
import { registerEventPayload } from './index.js';

/** `device.upserted`: an Appareil as `GET /api/devices` lists it (`current: false`), when it is created or its state changes. */
export const zDeviceEventPayload = registerEventPayload('device', zDevice);

declare module './index.js' {
  interface EventPayloads {
    device: Device;
  }
}
