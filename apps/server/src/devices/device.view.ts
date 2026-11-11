import type { Device, Wrap } from '@crewdeck/contracts';

/** What of a `devices` row the page sees: `GET /api/devices`, the `devices` slice, the payload of `device.upserted`. */
export const DEVICE_VIEW = { id: true, name: true, state: true, approvedAt: true, revokedAt: true, lastSeenAt: true } as const;

interface DeviceRow {
  id: string;
  name: string;
  state: Device['state'];
  approvedAt: Date | null;
  revokedAt: Date | null;
  lastSeenAt: Date | null;
}

/** The Appareil, `current` when it is the one of the page that asked. */
export const toDevice = (row: DeviceRow, currentId?: string): Device => ({
  id: row.id,
  name: row.name,
  state: row.state,
  approvedAt: row.approvedAt?.toISOString() ?? null,
  revokedAt: row.revokedAt?.toISOString() ?? null,
  lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
  current: row.id === currentId,
});

/** A byte string of the API (base64url, no padding) as a column's bytes, and back. */
export const bytesOf = (text: string): Uint8Array<ArrayBuffer> => new Uint8Array(Buffer.from(text, 'base64url'));
export const textOf = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64url');

/** A wrap's columns. */
export const wrapColumns = (wrap: Wrap) => ({ enc: bytesOf(wrap.enc), ciphertext: bytesOf(wrap.ciphertext), tag: bytesOf(wrap.tag) });

/** A wrap from its columns. */
export const wrapOf = (row: { enc: Uint8Array; ciphertext: Uint8Array; tag: Uint8Array }): Wrap => ({
  enc: textOf(row.enc),
  ciphertext: textOf(row.ciphertext),
  tag: textOf(row.tag),
});
