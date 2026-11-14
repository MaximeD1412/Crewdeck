import { DEFAULT_ACCOUNT_SETTINGS, type Device } from '@crewdeck/contracts';
import { Banner, t } from '@crewdeck/sdk';
import { createDispatcher } from './actions/dispatcher.js';
import { boot } from './app.js';
import { APPROVE_DEVICE_TAG, NEW_DEVICE_TAG } from './dialogs/device-approval.js';
import type { DeviceApprovalKeys } from './keys/approval.js';
import type { VaultState } from './keys/vault.js';
import { createStore } from './store/store.js';
import { ADD_DEVICE_ID } from './views/devices.js';

const PILOT = { id: '018f6b2a-7c3d-7e4f-9a1b-2c3d4e5f6a7b', login: 'octocat', avatarUrl: null, timeZone: 'Europe/Paris', gettingStartedStep: 'done' } as const;
const TRUSTED: Device = {
  id: '018f6b2a-7c3d-7e4f-9a1b-2c3d4e5f6a74',
  name: 'Firefox sur Linux',
  state: 'trusted',
  approvedAt: '2026-11-03T09:00:00.000Z',
  revokedAt: null,
  lastSeenAt: null,
  current: false,
};

const started = async (vault: VaultState) => {
  history.replaceState(null, '', '/parametres');
  const root = document.createElement('div');
  document.body.append(root);
  const store = createStore();
  store.registerSlice('pilot', { shape: 'single' });
  store.registerSlice('device', { shape: 'collection', snapshotKey: 'devices' });
  store.registerSlice('settings', { shape: 'single' });
  const approval: DeviceApprovalKeys = {
    register: vi.fn(() => new Promise<never>(() => undefined)),
    adopt: vi.fn(),
    check: vi.fn(),
    approve: vi.fn(),
  };
  const app = await boot({
    root,
    dispatcher: createDispatcher(),
    me: async () => PILOT,
    store,
    connection: { start: vi.fn<() => void>(), stop: vi.fn<() => void>() },
    client: { command: vi.fn(), query: vi.fn() },
    keys: {
      linkKeys: { browserPairing: vi.fn(), adoptDevice: vi.fn(), confirmPairing: vi.fn() },
      nameDevice: async () => undefined,
      unlockVault: async () => {
        store.setVaultState(vault);
        return vault;
      },
      approval,
    },
  });
  store.applySnapshot({ seq: 1, pilot: PILOT, runner: null, 'runner-link': null, 'ai-account': [], devices: [TRUSTED], settings: { ...DEFAULT_ACCOUNT_SETTINGS, timeZone: 'Europe/Paris' }, decisions: [] });
  await vi.waitFor(() => expect(store.getState().vaultState).toBe(vault));
  return { root, app, approval, store };
};

// Its own file: a page has one Skin, booted once.
describe('the page’s Appareils', () => {
  it('offers a browser with no Appareil to approve it, then once approved lists the Appareils on /parametres, whose « Ajouter un Appareil » approves another one', async () => {
    const { root, app, approval, store } = await started('no-device');
    // The Banner's button opens this browser's code.
    const button = await vi.waitFor(() => {
      const found = root.querySelector<HTMLElement>(`${Banner.tag} > cd-button[slot=actions]`);
      if (!found) throw new Error('no Banner button');
      return found;
    });
    expect(document.querySelector(NEW_DEVICE_TAG)).toBeNull();
    button.click();
    expect(document.querySelector(NEW_DEVICE_TAG)).not.toBeNull();
    await vi.waitFor(() => expect(approval.register).toHaveBeenCalledTimes(1));

    // Approved, the vault open: no Banner, and « Ajouter un Appareil » opens the approval of another one.
    store.setVaultState('unlocked');
    expect(root.querySelector(`${Banner.tag}[slot=banner]`)).toBeNull();
    const page = root.querySelector('cd-page-parametres') as HTMLElement;
    const card = page.querySelector(':scope > cd-card[slot=devices]') as HTMLElement & { data: { title: string } };
    expect(card.data.title).toBe(t('devices.title'));
    expect(document.querySelector(APPROVE_DEVICE_TAG)).toBeNull();
    (card.querySelector(`#${ADD_DEVICE_ID}`) as HTMLElement).click();
    expect(document.querySelector(APPROVE_DEVICE_TAG)).not.toBeNull();
    // One approval dialog at a time.
    expect(document.querySelector(NEW_DEVICE_TAG)).toBeNull();
    app.stop();
  });
});
