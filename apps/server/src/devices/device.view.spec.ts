import { zDevice, zWrap } from '@crewdeck/contracts';
import { deviceIdOf } from './devices.service.js';
import { bytesOf, textOf, toDevice, wrapColumns, wrapOf } from './device.view.js';

const ROW = {
  id: '019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6a01',
  name: 'Chrome sur Windows',
  state: 'trusted' as const,
  approvedAt: new Date('2026-11-11T08:00:00.000Z'),
  revokedAt: null,
  lastSeenAt: null,
};

describe('the device view', () => {
  it('is the device payload, current only for the id the page named, without its public key', () => {
    expect(zDevice.parse(toDevice(ROW, ROW.id))).toEqual({
      id: ROW.id,
      name: 'Chrome sur Windows',
      state: 'trusted',
      approvedAt: '2026-11-11T08:00:00.000Z',
      revokedAt: null,
      lastSeenAt: null,
      current: true,
    });
    expect(toDevice(ROW).current).toBe(false);
    expect(toDevice(ROW, '019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6a02').current).toBe(false);
  });

  it('stores a wrap as its bytes and gives it back as the API spells it', () => {
    const wrap = zWrap.parse({ enc: textOf(new Uint8Array(32).fill(1)), ciphertext: textOf(new Uint8Array(48).fill(2)), tag: textOf(new Uint8Array(32).fill(3)) });

    const columns = wrapColumns(wrap);

    expect(columns.enc).toEqual(new Uint8Array(32).fill(1));
    expect(columns.ciphertext).toHaveLength(48);
    expect(wrapOf(columns)).toEqual(wrap);
    expect(textOf(bytesOf('AQID'))).toBe('AQID');
  });

  it('reads the Appareil the page names only when it is an id', () => {
    expect(deviceIdOf(ROW.id)).toBe(ROW.id);
    expect(deviceIdOf('pas-un-id')).toBeUndefined();
    expect(deviceIdOf(undefined)).toBeUndefined();
  });
});
