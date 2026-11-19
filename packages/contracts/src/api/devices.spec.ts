import { DEVICE_CODE_PREFIX, eventPayloadSchema, zApproveDevice, zDevice, zDeviceApproval, zDeviceCreated, zDeviceList, zNewDeviceRequest, zPendingDevice } from '../index.js';

const DEVICE = {
  id: '019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6a01',
  name: 'Chrome sur Windows',
  state: 'trusted',
  approvedAt: '2026-11-11T08:00:00.000Z',
  revokedAt: null,
  lastSeenAt: null,
  current: true,
};

describe('zDevice', () => {
  it('is an item of GET /api/devices and the payload of device.upserted', () => {
    expect(zDeviceList.parse({ items: [DEVICE] })).toEqual({ items: [DEVICE] });
    expect(eventPayloadSchema('device.upserted')?.parse({ ...DEVICE, current: false })).toMatchObject({ state: 'trusted' });
    expect(zDevice.safeParse({ ...DEVICE, state: 'lost' }).success).toBe(false);
  });
});

const KEY = 'A'.repeat(43);
const WRAP = { enc: KEY, ciphertext: 'B'.repeat(64), tag: KEY };

describe('a new Appareil (E2E-3)', () => {
  it('registers a public key with its proof, never the secret', () => {
    expect(zNewDeviceRequest.parse({ publicKey: KEY, name: ' Safari sur iPhone ', proof: KEY })).toEqual({ publicKey: KEY, name: 'Safari sur iPhone', proof: KEY });
    expect(zNewDeviceRequest.safeParse({ publicKey: KEY, name: 'Safari', proof: KEY, secret: 'X' }).data).not.toHaveProperty('secret');
    expect(zNewDeviceRequest.safeParse({ publicKey: 'short', name: 'Safari', proof: KEY }).success).toBe(false);
    expect(zDeviceCreated.safeParse({ id: DEVICE.id, shortId: '7K2Q', expiresAt: '2026-11-11T08:10:00.000Z' }).success).toBe(true);
    expect(zDeviceCreated.safeParse({ id: DEVICE.id, shortId: '7K2U', expiresAt: '2026-11-11T08:10:00.000Z' }).success).toBe(false);
  });

  it('is approved by a trusted Appareil or the Runner, with a wrap and a proof', () => {
    const pending = { id: DEVICE.id, shortId: '7K2Q', name: 'Safari sur iPhone', publicKey: KEY, proof: KEY, expiresAt: '2026-11-11T08:10:00.000Z' };
    expect(zPendingDevice.parse(pending)).toEqual(pending);
    const approve = { approver: { type: 'runner', id: DEVICE.id }, vaultKeyVersion: 1, wrap: WRAP, proof: KEY };
    expect(zApproveDevice.parse(approve)).toEqual(approve);
    expect(zApproveDevice.safeParse({ ...approve, approver: { type: 'pilot', id: DEVICE.id } }).success).toBe(false);
    expect(zDeviceApproval.parse({ approver: { type: 'device', id: DEVICE.id, publicKey: KEY }, proof: KEY })).toMatchObject({ proof: KEY });
    expect(`${DEVICE_CODE_PREFIX}7K2Q-${'A'.repeat(26)}`).toMatch(/^crewdeck:appareil:/);
  });
});
