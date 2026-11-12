import type { Device } from '@crewdeck/contracts';
import { formatDate, t, type Banner, type Button, type Card, type ComposantData, type ListRow, type StatusBadge } from '@crewdeck/sdk';
import type { PlacedNode } from '../placed.js';

/** The id of « Ajouter un Appareil », whose click opens the core's approval dialog (`app.ts`). */
export const ADD_DEVICE_ID = 'crewdeck-add-device';

const row = (device: Device): PlacedNode => ({
  tag: 'cd-list-row',
  data: {
    title: device.name,
    ...(device.approvedAt ? { meta: t('devices.approvedAt', { date: formatDate(device.approvedAt) }) } : {}),
    icon: 'key',
  } satisfies ComposantData<typeof ListRow>,
  children: device.current
    ? [{ tag: 'cd-status-badge', slot: 'trailing', data: { tone: 'accent', label: t('devices.current') } satisfies ComposantData<typeof StatusBadge> }]
    : [],
});

/**
 * The « Appareils » section of the Paramètres (pure, E2E-3): the Pilote's
 * trusted Appareils, the oldest first, the current one named; « Ajouter un
 * Appareil »; and, while only one holds the vault key, the Banner that says
 * a second one keeps the encrypted data from being lost (OPS-1). None before
 * the snapshot gave the Appareils.
 */
export const devicesCard = (devices: ReadonlyMap<string, Device> | undefined): PlacedNode | null => {
  if (!devices) return null;
  const trusted = [...devices.values()]
    .filter((device) => device.state === 'trusted')
    .sort((a, b) => (a.approvedAt ?? '').localeCompare(b.approvedAt ?? ''));
  const add: PlacedNode = {
    tag: 'cd-button',
    slot: 'actions',
    id: ADD_DEVICE_ID,
    data: { label: t('devices.add'), variant: 'secondary', size: 'sm', icon: 'plus' } satisfies ComposantData<typeof Button>,
  };
  const single: PlacedNode[] =
    trusted.length === 1 ? [{ tag: 'cd-banner', data: { tone: 'caution', title: t('devices.single'), icon: 'shield' } satisfies ComposantData<typeof Banner> }] : [];
  return {
    tag: 'cd-card',
    slot: 'devices',
    data: { title: t('devices.title'), label: t('devices.label'), count: trusted.length } satisfies ComposantData<typeof Card>,
    children: [add, ...single, ...trusted.map(row)],
  };
};
