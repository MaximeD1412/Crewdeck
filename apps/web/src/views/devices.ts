import type { Device } from '@crewdeck/contracts';
import { formatDate, t, type Banner, type Button, type Card, type ComposantData, type ListRow, type StatusBadge } from '@crewdeck/sdk';
import type { ConfirmDialogOptions } from '../dialogs/confirm.js';
import type { PlacedNode } from '../placed.js';

/** The id of « Ajouter un Appareil », whose click opens the core's approval dialog (`app.ts`). */
export const ADD_DEVICE_ID = 'crewdeck-add-device';

const REVOKE_PREFIX = 'crewdeck-revoke-device-';

/** The id of an Appareil's « Retirer », whose click opens the core's confirmation (`app.ts`, E2E-4). */
export const revokeDeviceId = (deviceId: string): string => `${REVOKE_PREFIX}${deviceId}`;

/** The Appareil of a « Retirer » by its id, `null` for another element's. */
export const revokedDeviceOf = (elementId: string): string | null =>
  elementId.startsWith(REVOKE_PREFIX) && elementId.length > REVOKE_PREFIX.length ? elementId.slice(REVOKE_PREFIX.length) : null;

const row = (device: Device, current: boolean): PlacedNode => ({
  tag: 'cd-list-row',
  data: {
    title: device.name,
    ...(device.approvedAt ? { meta: t('devices.approvedAt', { date: formatDate(device.approvedAt) }) } : {}),
    icon: 'key',
  } satisfies ComposantData<typeof ListRow>,
  children: [
    ...(current ? [{ tag: 'cd-status-badge', slot: 'trailing', data: { tone: 'accent', label: t('devices.current') } satisfies ComposantData<typeof StatusBadge> } as const] : []),
    { tag: 'cd-button', slot: 'trailing', id: revokeDeviceId(device.id), data: { label: t('devices.revoke'), variant: 'ghost', size: 'sm' } satisfies ComposantData<typeof Button> },
  ],
});

/**
 * The « Appareils » section of the Paramètres (pure, E2E-3): the Pilote's
 * trusted Appareils, the oldest first, this page's one (`currentId`, the
 * slice's `current` being every tab's) named; « Ajouter un
 * Appareil »; each one's « Retirer » (E2E-4); and, while only one holds the vault key, the Banner that says
 * a second one keeps the encrypted data from being lost (OPS-1). None before
 * the snapshot gave the Appareils, nor while none is trusted: no Appareil to
 * approve from (« Premiers pas » makes the first one).
 */
export const devicesCard = (devices: ReadonlyMap<string, Device> | undefined, currentId?: string | null): PlacedNode | null => {
  if (!devices) return null;
  const trusted = [...devices.values()]
    .filter((device) => device.state === 'trusted')
    .sort((a, b) => (a.approvedAt ?? '').localeCompare(b.approvedAt ?? ''));
  if (trusted.length === 0) return null;
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
    children: [add, ...single, ...trusted.map((device) => row(device, device.id === currentId))],
  };
};

/** Whether `deviceId` is the Pilote's last trusted Appareil: its revocation then warns first (OPS-1), and says so to the server. */
export const isLastTrusted = (devices: ReadonlyMap<string, Device> | undefined, deviceId: string): boolean =>
  !!devices && devices.get(deviceId)?.state === 'trusted' && [...devices.values()].filter((one) => one.state === 'trusted').length === 1;

/**
 * What « Retirer » asks in the core's dialog (E2E-4, a product's action, not
 * an Action sensible): what happens to the Appareil and to the vault key,
 * that it is this browser's when it is, and, before the last trusted
 * Appareil, that reinstalling the Runner then loses the Idées' text (OPS-1).
 * None for an Appareil the store does not hold or already revoked. `last`:
 * the server said it is the last one by now (409 `devices.last-changed`),
 * before the store heard of the other revocation.
 */
export const revokeConfirmation = (
  devices: ReadonlyMap<string, Device> | undefined,
  deviceId: string,
  currentId: string | null,
  { last: known = false }: { last?: boolean } = {},
): ConfirmDialogOptions | null => {
  const device = devices?.get(deviceId);
  if (!devices || !device || device.state === 'revoked') return null;
  const last = known || isLastTrusted(devices, deviceId);
  return {
    title: t('devices.revoke.title', { name: device.name }),
    confirmLabel: t('devices.revoke.confirm'),
    icon: 'trash',
    tone: 'danger',
    consequences: {
      lead: t('devices.revoke.lead'),
      items: [
        ...(device.state === 'trusted' ? [{ strong: t('devices.revoke.rotation.strong'), text: t('devices.revoke.rotation') }] : []),
        ...(device.id === currentId ? [{ strong: t('devices.revoke.current.strong'), text: t('devices.revoke.current') }] : []),
      ],
      ...(last ? { note: t('devices.revoke.last') } : {}),
    },
  };
};
