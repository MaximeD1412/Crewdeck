import { z } from 'zod';
import { DEVICE_NAME_MAX_LENGTH, zBytes32, zVaultKeyVersion, zWrap } from '../keys/pairing.js';
import { zId, zInstant } from '../values.js';
import { withSeq } from './commands.js';
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
export const DEVICE_PROOF_LABELS = { new: 'crewdeck/v1/device/new', approve: 'crewdeck/v1/device/approve', runner: 'crewdeck/v1/device/runner' } as const;

/**
 * The Runner's public key a trusted Appareil authenticated, handed on to the
 * one it approves: `proof = HMAC-SHA256(secret, "crewdeck/v1/device/runner" ‖
 * newPublicKey ‖ runnerPublicKey)`, which the new page checks before it opens
 * a Session's keys with it.
 */
export const zApprovalRunner = z.object({ publicKey: zBytes32, proof: zBytes32 });
export type ApprovalRunner = z.infer<typeof zApprovalRunner>;

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
 *
 * For the Sessions (SESSION-1), when the approver knows the Runner's key:
 * - `runner`, from a trusted Appareil only: that key and its proof, for the new page;
 * - `holder`, for the Runner: the new public key in an authenticated wrap
 *   from the approver to the Runner (`info` `crewdeck/v1/device-holder`,
 *   additional data the new Appareil's id); the Runner wraps a Session's
 *   key for it once the wrap opens with the key of an Appareil it holds.
 * A trusted Appareil sends both or neither.
 */
export const zApproveDevice = z.object({
  approver: z.object({ type: zApproverType, id: zId }),
  vaultKeyVersion: zVaultKeyVersion,
  wrap: zWrap,
  proof: zBytes32,
  runner: zApprovalRunner.optional(),
  holder: zWrap.optional(),
});
export type ApproveDevice = z.infer<typeof zApproveDevice>;

/** `GET /api/devices/:id/approval` (session): who approved the Appareil, the public key it checks `proof` and its wrap with. */
export const zDeviceApproval = z.object({
  approver: z.object({ type: zApproverType, id: zId, publicKey: zBytes32 }),
  proof: zBytes32,
  /** The Runner's key the approving Appareil handed on, when it had one. */
  runner: zApprovalRunner.optional(),
});
export type DeviceApproval = z.infer<typeof zDeviceApproval>;

/**
 * `GET /api/runner/devices/holders` (Runner): the Pilote's trusted Appareils
 * an approval sent a holder wrap for, each with its approver's public key.
 * The Runner takes one only when its wrap opens from a key it already holds
 * (the first Appareil's, its own, or one taken before): the server can hide
 * one, never add one.
 *
 * `vouchers` (E2E-4): the revoked Appareils that had been approved the same
 * way, for the chain only. A revoked approver's attestation still vouches
 * for the Appareils it approved while trusted, so the Runner authenticates
 * them after it is gone; a voucher itself is never a recipient. Absent from
 * an older server.
 */
const zDeviceHolder = z.object({ deviceId: zId, publicKey: zBytes32, approverPublicKey: zBytes32, wrap: zWrap });
export const zDeviceHolders = z.object({
  holders: z.array(zDeviceHolder),
  vouchers: z.array(zDeviceHolder).optional(),
});
export type DeviceHolders = z.infer<typeof zDeviceHolders>;

/**
 * `POST /api/devices/:id/revoke` (session, E2E-4): the Appareil `revoked`, its
 * wraps deleted and the vault's rotation pending, with the `seq` of its last
 * `device.upserted`. The current Appareil may revoke itself.
 *
 * `last`: the dialog warned that it is the last trusted Appareil (OPS-1).
 * Without it, the server answers 409 `devices.last-changed` when it is, by
 * then (another revocation committed meanwhile): the page asks again.
 */
export const zRevokeDevice = withSeq(z.object({ last: z.boolean().default(false) }));
export type RevokeDevice = z.infer<typeof zRevokeDevice>;
