import { eventPayloadSchema, zDevice, zDeviceList } from '../index.js';

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
