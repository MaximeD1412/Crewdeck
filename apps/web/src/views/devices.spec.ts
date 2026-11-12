import type { Device } from '@crewdeck/contracts';
import { formatDate, t } from '@crewdeck/sdk';
import { ADD_DEVICE_ID, devicesCard } from './devices.js';

const device = (id: string, name: string, more: Partial<Device> = {}): Device => ({
  id,
  name,
  state: 'trusted',
  approvedAt: '2026-11-03T09:00:00.000Z',
  revokedAt: null,
  lastSeenAt: null,
  current: false,
  ...more,
});

const byId = (...devices: Device[]) => new Map(devices.map((one) => [one.id, one]));

const SINGLE = { tag: 'cd-banner', data: { tone: 'caution', title: t('devices.single'), icon: 'shield' } };

describe('devicesCard', () => {
  it('lists the trusted Appareils, the current one named, and offers to add one', () => {
    const card = devicesCard(
      byId(
        device('dev_1', 'Chrome sur Linux', { current: true }),
        device('dev_2', 'Safari sur iOS', { approvedAt: '2026-11-10T09:00:00.000Z' }),
        device('dev_3', 'Firefox sur Android', { state: 'pending', approvedAt: null }),
        device('dev_4', 'Edge sur Windows', { state: 'revoked' }),
      ),
    );
    expect(card).toEqual({
      tag: 'cd-card',
      slot: 'devices',
      data: { title: t('devices.title'), label: t('devices.label'), count: 2 },
      children: [
        { tag: 'cd-button', slot: 'actions', id: ADD_DEVICE_ID, data: { label: t('devices.add'), variant: 'secondary', size: 'sm', icon: 'plus' } },
        {
          tag: 'cd-list-row',
          data: { title: 'Chrome sur Linux', meta: t('devices.approvedAt', { date: formatDate('2026-11-03T09:00:00.000Z') }), icon: 'key' },
          children: [{ tag: 'cd-status-badge', slot: 'trailing', data: { tone: 'accent', label: t('devices.current') } }],
        },
        {
          tag: 'cd-list-row',
          data: { title: 'Safari sur iOS', meta: t('devices.approvedAt', { date: formatDate('2026-11-10T09:00:00.000Z') }), icon: 'key' },
          children: [],
        },
      ],
    });
  });

  it('warns that one Appareil alone holds the encrypted data (OPS-1), not with two', () => {
    const one = devicesCard(byId(device('dev_1', 'Chrome sur Linux', { current: true })));
    expect(one?.children?.[1]).toEqual(SINGLE);
    const two = devicesCard(byId(device('dev_1', 'Chrome sur Linux', { current: true }), device('dev_2', 'Safari sur iOS')));
    expect(two?.children).not.toContainEqual(SINGLE);
  });

  it('is none until the snapshot gave the Appareils', () => {
    expect(devicesCard(undefined)).toBeNull();
  });
});
