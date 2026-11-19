import type { Device } from '@crewdeck/contracts';
import { formatDate, t } from '@crewdeck/sdk';
import { ADD_DEVICE_ID, devicesCard, revokeConfirmation, revokeDeviceId, revokedDeviceOf } from './devices.js';

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

const revoke = (id: string) => ({ tag: 'cd-button', slot: 'trailing', id: revokeDeviceId(id), data: { label: t('devices.revoke'), variant: 'ghost', size: 'sm' } });

const SINGLE = { tag: 'cd-banner', data: { tone: 'caution', title: t('devices.single'), icon: 'shield' } };

describe('devicesCard', () => {
  it('lists the trusted Appareils, this page’s one named (the slice’s `current` is every tab’s, false), each with « Retirer », and offers to add one', () => {
    const card = devicesCard(
      byId(
        device('dev_1', 'Chrome sur Linux'),
        device('dev_2', 'Safari sur iOS', { approvedAt: '2026-11-10T09:00:00.000Z' }),
        device('dev_3', 'Firefox sur Android', { state: 'pending', approvedAt: null }),
        device('dev_4', 'Edge sur Windows', { state: 'revoked' }),
      ),
      'dev_1',
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
          children: [{ tag: 'cd-status-badge', slot: 'trailing', data: { tone: 'accent', label: t('devices.current') } }, revoke('dev_1')],
        },
        {
          tag: 'cd-list-row',
          data: { title: 'Safari sur iOS', meta: t('devices.approvedAt', { date: formatDate('2026-11-10T09:00:00.000Z') }), icon: 'key' },
          children: [revoke('dev_2')],
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

  it('is none until the snapshot gave the Appareils, nor while none is trusted (no Appareil to approve from)', () => {
    expect(devicesCard(undefined)).toBeNull();
    expect(devicesCard(new Map())).toBeNull();
    expect(devicesCard(new Map([['dev_9', { id: 'dev_9', name: 'Safari sur iOS', state: 'pending', approvedAt: null, revokedAt: null, lastSeenAt: null, current: true }]]))).toBeNull();
  });
});

describe('revoking an Appareil (E2E-4)', () => {
  it('finds the Appareil of a « Retirer » clicked, and none for another id', () => {
    expect(revokedDeviceOf(revokeDeviceId('019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6a01'))).toBe('019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6a01');
    expect(revokedDeviceOf(ADD_DEVICE_ID)).toBeNull();
    expect(revokedDeviceOf('')).toBeNull();
  });

  it('says what happens: no more encrypted data served to it, the key changed after', () => {
    const asked = revokeConfirmation(byId(device('dev_1', 'Chrome sur Linux'), device('dev_2', 'Safari sur iOS')), 'dev_2', 'dev_1');
    expect(asked).toEqual({
      title: t('devices.revoke.title', { name: 'Safari sur iOS' }),
      confirmLabel: t('devices.revoke.confirm'),
      icon: 'trash',
      tone: 'danger',
      consequences: {
        lead: t('devices.revoke.lead'),
        items: [{ strong: t('devices.revoke.rotation.strong'), text: t('devices.revoke.rotation') }],
      },
    });
  });

  it('says it is this Appareil, whose keys this browser forgets', () => {
    const asked = revokeConfirmation(byId(device('dev_1', 'Chrome sur Linux'), device('dev_2', 'Safari sur iOS')), 'dev_1', 'dev_1');
    expect(asked?.consequences.items).toContainEqual({ strong: t('devices.revoke.current.strong'), text: t('devices.revoke.current') });
    expect(asked?.consequences.note).toBeUndefined();
  });

  it('warns first, before the last trusted Appareil, that reinstalling the Runner then loses the Idées’ text (OPS-1)', () => {
    const asked = revokeConfirmation(byId(device('dev_1', 'Chrome sur Linux'), device('dev_3', 'Firefox sur Android', { state: 'pending', approvedAt: null })), 'dev_1', 'dev_1');
    expect(asked?.consequences.note).toBe('C’est ton dernier Appareil de confiance : si tu réinstalles ensuite le Runner, le texte de tes Idées sera perdu.');
    // A pending one is no Appareil of trust: revoking it warns of nothing.
    const pending = revokeConfirmation(byId(device('dev_1', 'Chrome sur Linux'), device('dev_3', 'Firefox sur Android', { state: 'pending', approvedAt: null })), 'dev_3', 'dev_1');
    expect(pending?.consequences.note).toBeUndefined();
  });

  it('asks nothing for an Appareil the store does not hold, or already revoked', () => {
    expect(revokeConfirmation(byId(device('dev_1', 'Chrome sur Linux')), 'dev_9', 'dev_1')).toBeNull();
    expect(revokeConfirmation(byId(device('dev_1', 'Chrome sur Linux', { state: 'revoked' })), 'dev_1', 'dev_1')).toBeNull();
    expect(revokeConfirmation(undefined, 'dev_1', 'dev_1')).toBeNull();
  });
});
