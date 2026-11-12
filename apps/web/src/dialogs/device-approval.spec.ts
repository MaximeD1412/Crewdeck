/// <reference types="vite/client" />
import '@crewdeck/skin-passerelle/tokens.css';
import type { Device } from '@crewdeck/contracts';
import { t } from '@crewdeck/sdk';
import { userEvent } from 'vitest/browser';
import { ApiError } from '../api/request.js';
import type { CheckedDevice, DeviceApprovalKeys, NewDeviceCode } from '../keys/approval.js';
import type { VaultState } from '../keys/vault.js';
import type { StoreState } from '../store/store.js';
import { APPROVE_DEVICE_TAG, NEW_DEVICE_TAG, openApproveDevice, openNewDevice, type Scanner } from './device-approval.js';

const SECRET = 'ABCDEFGHJKMNPQRSTVWXYZ0120';
const NOW = Date.parse('2026-11-12T09:00:00.000Z');
const CODE: NewDeviceCode = { id: 'dev_new', shortId: '7K2Q', secret: SECRET, expiresAt: '2026-11-12T09:10:00.000Z' };
const PENDING: Device = { id: 'dev_new', name: 'Safari sur iOS', state: 'pending', approvedAt: null, revokedAt: null, lastSeenAt: null, current: true };

const shadow = (tag: string): ShadowRoot => {
  const host = document.querySelector(tag);
  if (!host?.shadowRoot) throw new Error(`no ${tag} open`);
  return host.shadowRoot;
};
const textOf = (tag: string) => shadow(tag).querySelector('.box')?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
const heading = (tag: string) => shadow(tag).querySelector('h2')?.textContent?.trim();
const button = (tag: string, label: string) => {
  const found = [...shadow(tag).querySelectorAll('button')].find((b) => b.textContent?.trim() === label);
  if (!found) throw new Error(`no button ${label}`);
  return found;
};
const labels = (tag: string) => [...shadow(tag).querySelectorAll('.actions button')].map((b) => b.textContent?.trim());

/** The store's Appareils, changed as its events would. */
const fakeStore = (devices: Device[]) => {
  let state = { slices: { device: new Map(devices.map((d) => [d.id, d])) } } as unknown as StoreState;
  const listeners = new Set<(state: StoreState) => void>();
  return {
    listeners,
    getState: () => state,
    subscribe(fn: (state: StoreState) => void) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    upsert(device: Device) {
      const device_ = new Map(state.slices.device);
      device_.set(device.id, device);
      state = { ...state, slices: { ...state.slices, device: device_ } };
      for (const fn of listeners) fn(state);
    },
  };
};

const opener = () => {
  const element = document.createElement('button');
  element.textContent = 'Approuver cet Appareil';
  document.body.append(element);
  element.focus();
  return element;
};

afterEach(() => document.body.replaceChildren());

describe('crewdeck-new-device', () => {
  const newDevice = (approval: Partial<Pick<DeviceApprovalKeys, 'register' | 'adopt'>> = {}, now = () => NOW) => {
    const store = fakeStore([]);
    const keys = {
      register: vi.fn(async () => CODE),
      adopt: vi.fn(async (): Promise<'approved' | 'invalid'> => 'approved'),
      ...approval,
    };
    const unlockVault = vi.fn(async (): Promise<VaultState> => 'unlocked');
    const dialog = openNewDevice({ approval: keys, store, unlockVault, now });
    return { store, keys, unlockVault, dialog };
  };

  it('registers this browser and shows its QR code, its code, the Runner’s command and the time left; approved, it adopts the approval and opens the vault', async () => {
    const { store, keys, unlockVault } = newDevice();
    await expect.poll(() => shadow(NEW_DEVICE_TAG).querySelector('canvas')?.width ?? 0).toBeGreaterThan(0);
    const dialog = shadow(NEW_DEVICE_TAG).querySelector('dialog') as HTMLDialogElement;
    expect(dialog.matches(':modal')).toBe(true);
    expect(heading(NEW_DEVICE_TAG)).toBe(t('devices.new.title'));
    const canvas = shadow(NEW_DEVICE_TAG).querySelector('canvas');
    expect(canvas?.getAttribute('role')).toBe('img');
    expect(canvas?.getAttribute('aria-label')).toBe(t('devices.new.qr'));
    const codes = [...shadow(NEW_DEVICE_TAG).querySelectorAll('code')].map((code) => code.textContent);
    expect(codes).toEqual([`7K2Q-${SECRET}`, `crewdeck-runner appareils approuver 7K2Q-${SECRET}`]);
    expect(textOf(NEW_DEVICE_TAG)).toContain(t('devices.new.expires', { time: '10:00' }));
    expect(textOf(NEW_DEVICE_TAG)).toContain(t('devices.new.waiting'));
    expect(keys.register).toHaveBeenCalledTimes(1);

    // Another Appareil's change, then its own pending one: still waiting.
    store.upsert({ ...PENDING, id: 'dev_other', state: 'trusted' });
    store.upsert(PENDING);
    expect(keys.adopt).not.toHaveBeenCalled();

    store.upsert({ ...PENDING, state: 'trusted', approvedAt: '2026-11-12T09:01:00.000Z' });
    await expect.poll(() => heading(NEW_DEVICE_TAG)).toBe(t('devices.new.approved.title'));
    expect(keys.adopt).toHaveBeenCalledWith(CODE);
    expect(unlockVault).toHaveBeenCalledTimes(1);
    expect(textOf(NEW_DEVICE_TAG)).toContain(t('devices.new.approved.text'));
    expect(labels(NEW_DEVICE_TAG)).toEqual([t('devices.close')]);
  });

  it('says « Code expiré » once its time is out, and « Recommencer » shows a new code', async () => {
    let now = NOW;
    const { keys } = newDevice({}, () => now);
    await expect.poll(() => shadow(NEW_DEVICE_TAG).querySelectorAll('code').length).toBe(2);
    now = Date.parse(CODE.expiresAt);
    await expect.poll(() => heading(NEW_DEVICE_TAG), { timeout: 3000 }).toBe(t('devices.new.expired.title'));
    expect(textOf(NEW_DEVICE_TAG)).toContain(t('devices.new.expired.text'));
    expect(shadow(NEW_DEVICE_TAG).querySelector('code')).toBeNull();

    now = NOW;
    button(NEW_DEVICE_TAG, t('devices.new.retry')).click();
    await expect.poll(() => heading(NEW_DEVICE_TAG)).toBe(t('devices.new.title'));
    await expect.poll(() => shadow(NEW_DEVICE_TAG).querySelectorAll('code').length).toBe(2);
    expect(keys.register).toHaveBeenCalledTimes(2);
  });

  it('opens nothing when the approval does not match its code, and says so', async () => {
    const { store, unlockVault } = newDevice({ adopt: vi.fn(async () => 'invalid' as const) });
    await expect.poll(() => shadow(NEW_DEVICE_TAG).querySelectorAll('code').length).toBe(2);
    store.upsert({ ...PENDING, state: 'trusted' });
    await expect.poll(() => textOf(NEW_DEVICE_TAG)).toContain(t('devices.new.invalid'));
    expect(unlockVault).not.toHaveBeenCalled();
    expect(labels(NEW_DEVICE_TAG)).toEqual([t('devices.close'), t('devices.new.retry')]);
  });

  it('says the server’s refusal (too many pending Appareils)', async () => {
    const message = 'Trois Appareils attendent déjà leur approbation.';
    newDevice({ register: vi.fn(async () => Promise.reject(new ApiError({ status: 422, code: 'devices.too-many-pending', message }))) });
    await expect.poll(() => textOf(NEW_DEVICE_TAG)).toContain(message);
  });

  it('closes on Escape, the focus back on its opener, and stops following the store', async () => {
    const element = opener();
    const { store } = newDevice();
    await expect.poll(() => shadow(NEW_DEVICE_TAG).querySelectorAll('code').length).toBe(2);
    await userEvent.keyboard('{Escape}');
    expect(document.querySelector(NEW_DEVICE_TAG)).toBeNull();
    expect(document.activeElement).toBe(element);
    expect(store.listeners.size).toBe(0);
  });
});

describe('crewdeck-approve-device', () => {
  const checked: CheckedDevice = {
    code: { shortId: '7K2Q', secret: SECRET },
    device: { id: 'dev_new', shortId: '7K2Q', name: 'Safari sur iOS', publicKey: 'k'.repeat(43), proof: 'p'.repeat(43), expiresAt: CODE.expiresAt },
  };

  const approver = (approval: Partial<Pick<DeviceApprovalKeys, 'check' | 'approve'>> = {}, extra: { vault?: VaultState; scanner?: Scanner } = {}) => {
    const keys = {
      check: vi.fn(async (): Promise<CheckedDevice | 'mismatch'> => checked),
      approve: vi.fn(async (): Promise<Device> => ({ ...PENDING, state: 'trusted', current: false })),
      ...approval,
    };
    openApproveDevice({ approval: keys, vaultState: () => extra.vault ?? 'unlocked', scanner: extra.scanner });
    return keys;
  };
  const input = () => shadow(APPROVE_DEVICE_TAG).querySelector('input') as HTMLInputElement;
  const paste = async (text: string) => {
    await expect.poll(() => shadow(APPROVE_DEVICE_TAG).querySelector('input')).not.toBeNull();
    await userEvent.fill(input(), text);
    button(APPROVE_DEVICE_TAG, t('devices.add.continue')).click();
  };

  it('takes the pasted code, checks its Appareil, asks « Approuver « name » ? », then approves it', async () => {
    const keys = approver();
    await expect.poll(() => document.activeElement === document.querySelector(APPROVE_DEVICE_TAG) && shadow(APPROVE_DEVICE_TAG).activeElement === input()).toBe(true);
    expect(heading(APPROVE_DEVICE_TAG)).toBe(t('devices.add.title'));
    expect(shadow(APPROVE_DEVICE_TAG).querySelector('label')?.textContent).toBe(t('devices.add.field'));
    expect(labels(APPROVE_DEVICE_TAG)).toEqual([t('devices.cancel'), t('devices.add.continue')]);

    await paste(`  crewdeck:appareil:7k2q-${SECRET.toLowerCase()} `);
    await expect.poll(() => heading(APPROVE_DEVICE_TAG)).toBe(t('devices.add.confirm', { name: 'Safari sur iOS' }));
    expect(keys.check).toHaveBeenCalledWith({ shortId: '7K2Q', secret: SECRET });
    expect(textOf(APPROVE_DEVICE_TAG)).toContain(t('devices.add.confirmText'));
    expect(keys.approve).not.toHaveBeenCalled();

    button(APPROVE_DEVICE_TAG, t('devices.add.approve')).click();
    await expect.poll(() => textOf(APPROVE_DEVICE_TAG)).toContain(t('devices.add.approved', { name: 'Safari sur iOS' }));
    expect(keys.approve).toHaveBeenCalledWith(checked);
  });

  it('refuses what is not a code, a code whose proof does not match, and an unknown or used one with the server’s message', async () => {
    const unknown = 'Ce code est inconnu ou a expiré : affiche un nouveau code sur le nouvel Appareil.';
    const used = 'Cet Appareil n’attend plus d’approbation : son code a expiré ou a déjà servi.';
    const check = vi
      .fn<DeviceApprovalKeys['check']>()
      .mockResolvedValueOnce('mismatch')
      .mockRejectedValueOnce(new ApiError({ status: 404, code: 'devices.code-unknown', message: unknown }))
      .mockResolvedValue(checked);
    const keys = approver({ check, approve: vi.fn(async () => Promise.reject(new ApiError({ status: 409, code: 'devices.not-pending', message: used }))) });
    const error = () => shadow(APPROVE_DEVICE_TAG).querySelector('[role=alert]')?.textContent;

    await paste('7K2Q');
    await expect.poll(error).toBe(t('devices.add.badCode'));
    expect(check).not.toHaveBeenCalled();
    expect(input().getAttribute('aria-invalid')).toBe('true');
    expect(input().getAttribute('aria-describedby')).toBe('error');

    await paste(`7K2Q-${SECRET}`);
    await expect.poll(error).toBe(t('devices.add.mismatch'));
    await paste(`7K2Q-${SECRET}`);
    await expect.poll(error).toBe(unknown);

    await paste(`7K2Q-${SECRET}`);
    await expect.poll(() => heading(APPROVE_DEVICE_TAG)).toBe(t('devices.add.confirm', { name: 'Safari sur iOS' }));
    button(APPROVE_DEVICE_TAG, t('devices.add.approve')).click();
    await expect.poll(error).toBe(used);
    expect(keys.approve).toHaveBeenCalledTimes(1);
  });

  it('approves nothing from an Appareil whose vault is not open', async () => {
    const keys = approver({}, { vault: 'locked' });
    await expect.poll(() => textOf(APPROVE_DEVICE_TAG)).toContain(t('devices.add.locked'));
    expect(shadow(APPROVE_DEVICE_TAG).querySelector('input')).toBeNull();
    expect(labels(APPROVE_DEVICE_TAG)).toEqual([t('devices.close')]);
    expect(keys.check).not.toHaveBeenCalled();
  });

  it('offers « Scanner » only with a camera: the QR code read is checked, a camera that fails says to paste', async () => {
    const scan = vi
      .fn<Scanner['scan']>()
      .mockRejectedValueOnce(new DOMException('denied', 'NotAllowedError'))
      .mockResolvedValue(`crewdeck:appareil:7K2Q-${SECRET}`);
    const keys = approver({}, { scanner: { scan } });
    await expect.poll(() => labels(APPROVE_DEVICE_TAG)).toEqual([t('devices.cancel'), t('devices.add.scan'), t('devices.add.continue')]);

    button(APPROVE_DEVICE_TAG, t('devices.add.scan')).click();
    await expect.poll(() => shadow(APPROVE_DEVICE_TAG).querySelector('[role=alert]')?.textContent).toBe(t('devices.add.scanFailed'));

    button(APPROVE_DEVICE_TAG, t('devices.add.scan')).click();
    await expect.poll(() => heading(APPROVE_DEVICE_TAG)).toBe(t('devices.add.confirm', { name: 'Safari sur iOS' }));
    expect(scan.mock.calls[1]?.[0]).toBeInstanceOf(HTMLVideoElement);
    expect(keys.check).toHaveBeenCalledWith({ shortId: '7K2Q', secret: SECRET });

    document.body.replaceChildren();
    approver();
    await expect.poll(() => labels(APPROVE_DEVICE_TAG)).toEqual([t('devices.cancel'), t('devices.add.continue')]);
  });

  it('closes on « Annuler » and on Escape, the focus back on its opener', async () => {
    const element = opener();
    approver();
    await expect.poll(() => shadow(APPROVE_DEVICE_TAG).querySelector('input')).not.toBeNull();
    button(APPROVE_DEVICE_TAG, t('devices.cancel')).click();
    expect(document.querySelector(APPROVE_DEVICE_TAG)).toBeNull();
    expect(document.activeElement).toBe(element);

    element.focus();
    approver();
    await expect.poll(() => shadow(APPROVE_DEVICE_TAG).querySelector('input')).not.toBeNull();
    await userEvent.keyboard('{Escape}');
    expect(document.querySelector(APPROVE_DEVICE_TAG)).toBeNull();
    expect(document.activeElement).toBe(element);
  });
});
