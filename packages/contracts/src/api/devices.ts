import { z } from 'zod';
import { zId, zInstant } from '../values.js';

/**
 * The Appareils (ADR 0003, E2E-2): the browsers of the Pilote, each with its
 * own key pair. `pending` until it holds the vault key, `trusted` once it
 * does, `revoked` by the Pilote (E2E-4).
 */
export const DEVICE_STATES = ['pending', 'trusted', 'revoked'] as const;
export const zDeviceState = z.enum(DEVICE_STATES);
export type DeviceState = z.infer<typeof zDeviceState>;

/** The header a page names its Appareil in, on every API call. */
export const DEVICE_HEADER = 'X-Crewdeck-Device';

/** At most this many Appareils per Pilote are listed (`GET /api/devices` is bounded, ADR 0008). */
export const DEVICES_MAX = 100;

/**
 * An Appareil: an item of `GET /api/devices`, of the `devices` slice of
 * `GET /api/state` and the payload of `device.upserted`. `current` is the
 * Appareil of the page that asked (`X-Crewdeck-Device`): an event goes to
 * every tab, so its `current` is `false` and each page sets its own.
 */
export const zDevice = z.object({
  id: zId,
  name: z.string().min(1),
  state: zDeviceState,
  approvedAt: zInstant.nullable(),
  revokedAt: zInstant.nullable(),
  lastSeenAt: zInstant.nullable(),
  current: z.boolean(),
});
export type Device = z.infer<typeof zDevice>;

/** `GET /api/devices` (session): the Pilote's Appareils, newest first. */
export const zDeviceList = z.object({ items: z.array(zDevice).max(DEVICES_MAX) });
export type DeviceList = z.infer<typeof zDeviceList>;
