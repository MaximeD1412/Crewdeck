import { zDevice, zDeviceApproval, zDeviceCreated, zPendingDevice, zVaultKeyWrap } from '@crewdeck/contracts';
import type { Client } from '../api/client.js';
import { setCurrentDevice } from '../api/request.js';
import type { Store } from '../store/store.js';
import { createDeviceApproval, type DeviceApprovalKeys } from './approval.js';
import { createDeviceStore, type DeviceStore } from './device-store.js';
import { createLinkKeys, type LinkKeys } from './pairing.js';
import { createVault, type Vault, type VaultState } from './vault.js';

/** The page's keys (ADR 0003): this browser's Appareil, the vault, the link's pairing. */
export interface PageKeys {
  readonly linkKeys: LinkKeys;
  readonly vault: Vault;
  /** A new Appareil approved by its code, from either side. */
  readonly approval: DeviceApprovalKeys;
  /** At boot, signed in: names the Appareil this browser holds, if any, in the API's calls. */
  nameDevice(): Promise<void>;
  /** Opens the vault (`no-device` for a browser with no Appareil yet); never throws: what it cannot do leaves it `locked`. */
  unlockVault(): Promise<VaultState>;
}

export interface PageKeysOptions {
  readonly store: Pick<Store, 'setVaultState'>;
  readonly client: Pick<Client, 'query' | 'command'>;
  readonly userAgent: string;
  readonly devices?: DeviceStore;
}

export const createPageKeys = ({ store, client, userAgent, devices = createDeviceStore() }: PageKeysOptions): PageKeys => {
  const vault = createVault({
    devices,
    fetchWrap: (deviceId) => client.query(`/api/devices/${encodeURIComponent(deviceId)}/vault-key-wrap`, zVaultKeyWrap),
    onState: (state) => store.setVaultState(state),
  });
  const linkKeys = createLinkKeys({ devices, vault, userAgent, onDevice: setCurrentDevice });
  const id = encodeURIComponent;
  const approval = createDeviceApproval({
    devices,
    vault,
    userAgent,
    onDevice: setCurrentDevice,
    api: {
      register: (request) => client.command('POST', '/api/devices', request, zDeviceCreated),
      pending: (shortId) => client.query(`/api/devices/pending/${id(shortId)}`, zPendingDevice),
      approve: (deviceId, body) => client.command('POST', `/api/devices/${id(deviceId)}/approve`, body, zDevice),
      approval: (deviceId) => client.query(`/api/devices/${id(deviceId)}/approval`, zDeviceApproval),
    },
  });
  return {
    linkKeys,
    vault,
    approval,
    async nameDevice() {
      const device = await devices.getDevice().catch(() => null);
      if (device?.deviceId) setCurrentDevice(device.deviceId);
    },
    async unlockVault() {
      try {
        return await vault.unlockVault();
      } catch {
        store.setVaultState('locked');
        return 'locked';
      }
    },
  };
};
