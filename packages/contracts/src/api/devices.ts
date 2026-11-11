import { z } from 'zod';
import { DEVICE_NAME_MAX_LENGTH, zBytes32, zVaultKeyVersion, zWrap } from '../keys/pairing.js';
import { zId, zInstant } from '../values.js';
import { zShortId } from './runner-link.js';

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

/**
 * A new Appareil approved by a trusted one or by the Runner (E2E-3,
 * `docs/security/e2e.md` « New Appareil »). The new page draws a code
 * `<shortId>-<secret>` whose secret never leaves it, and registers its public
 * key with `proof_N`; the approver checks it, wraps the vault key for that key
 * and sends `proof_A`, which the new page checks before it opens the wrap.
 */
export const DEVICE_PROOF_LABELS = { new: 'crewdeck/v1/device/new', approve: 'crewdeck/v1/device/approve' } as const;

/** What the QR code of a new Appareil holds before its code: `crewdeck:appareil:<shortId>-<secret>`. */
export const DEVICE_CODE_PREFIX = 'crewdeck:appareil:';

/** A new Appareil's code lives this long. */
export const DEVICE_CODE_TTL_SECONDS = 600;

/** At most this many Appareils of a Pilote wait for their approval at once. */
export const PENDING_DEVICES_MAX = 3;

/** `POST /api/devices` (session): the new Appareil, its public key and `HMAC-SHA256(secret, "crewdeck/v1/device/new" ‖ publicKey)`. */
export const zNewDeviceRequest = z.object({
  publicKey: zBytes32,
  name: z.string().trim().min(1).max(DEVICE_NAME_MAX_LENGTH),
  proof: zBytes32,
});
export type NewDeviceRequest = z.infer<typeof zNewDeviceRequest>;

/** Its answer: the id, the short id of the code and when the code expires. */
export const zDeviceCreated = z.object({ id: zId, shortId: zShortId, expiresAt: zInstant });
export type DeviceCreated = z.infer<typeof zDeviceCreated>;

/** `GET /api/devices/pending/:shortId` (session) and `GET /api/runner/devices/pending/:shortId` (Runner): what the approver checks. */
export const zPendingDevice = z.object({
  id: zId,
  shortId: zShortId,
  name: z.string().min(1),
  publicKey: zBytes32,
  proof: zBytes32,
  expiresAt: zInstant,
});
export type PendingDevice = z.infer<typeof zPendingDevice>;

export const APPROVER_TYPES = ['device', 'runner'] as const;
export const zApproverType = z.enum(APPROVER_TYPES);
export type ApproverType = z.infer<typeof zApproverType>;

/**
 * `POST /api/devices/:id/approve` (session, a trusted Appareil) and
 * `POST /api/runner/devices/:id/approve` (Runner): the vault key wrapped by
 * the approver for the new Appareil (additional data `"<id>:<vaultKeyVersion>"`)
 * and `HMAC-SHA256(secret, "crewdeck/v1/device/approve" ‖ newPublicKey ‖ approverPublicKey)`.
 */
export const zApproveDevice = z.object({
  approver: z.object({ type: zApproverType, id: zId }),
  vaultKeyVersion: zVaultKeyVersion,
  wrap: zWrap,
  proof: zBytes32,
});
export type ApproveDevice = z.infer<typeof zApproveDevice>;

/** `GET /api/devices/:id/approval` (session): who approved the Appareil, the public key it checks `proof` and its wrap with. */
export const zDeviceApproval = z.object({
  approver: z.object({ type: zApproverType, id: zId, publicKey: zBytes32 }),
  proof: zBytes32,
});
export type DeviceApproval = z.infer<typeof zDeviceApproval>;
