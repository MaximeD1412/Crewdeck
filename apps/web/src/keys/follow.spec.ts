import type { Device, VaultState as VaultSlice } from '@crewdeck/contracts';
import { createStore } from '../store/store.js';
import { followVault } from './follow.js';
import type { RotationOutcome } from './rotation.js';

const SELF = '019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6a01';
const AT = '2026-11-19T09:00:00.000Z';
const device = (state: Device['state']): Device => ({ id: SELF, name: 'Firefox sur Linux', state, approvedAt: AT, revokedAt: null, lastSeenAt: null, current: false });

const setUp = ({ held = 1, outcome = 'rotated' as RotationOutcome } = {}) => {
  const store = createStore();
  store.registerSlice('device', { shape: 'collection', snapshotKey: 'devices' });
  store.registerSlice('vault', { shape: 'single' });
  let version: number | null = held;
  const unlockVault = vi.fn(async () => {
    version = store.getState().slices.vault?.version ?? version;
    store.setVaultState('unlocked');
    return 'unlocked' as const;
  });
  const rotateVault = vi.fn(async () => {
    if (outcome === 'rotated' && version !== null) version += 1;
    return outcome;
  });
  const refresh = vi.fn<() => void>();
  store.setVaultState('unlocked');
  const stop = followVault({ store, vault: { version: () => version }, unlockVault, rotateVault, refresh, currentDeviceId: () => SELF });
  let seq = 1;
  const snapshot = (vault: VaultSlice, state: Device['state'] = 'trusted') =>
    store.applySnapshot({ seq: seq++, devices: [device(state)], vault } as never);
  const event = (vault: VaultSlice) => store.applyEvent({ seq: seq++, type: 'vault.upserted', payload: vault, at: AT });
  return { store, unlockVault, rotateVault, refresh, stop, snapshot, event };
};

describe('the page following the vault (E2E-4)', () => {
  it('rotates once a revocation leaves it pending, then reads the state again', async () => {
    const { rotateVault, refresh, snapshot, event } = setUp();
    snapshot({ version: 1, rotationPending: false });
    expect(rotateVault).not.toHaveBeenCalled();

    event({ version: 1, rotationPending: true });
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(rotateVault).toHaveBeenCalledTimes(1);

    // Its own rotation's event: the version it already holds, nothing more.
    event({ version: 2, rotationPending: false });
    await Promise.resolve();
    expect(rotateVault).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('opens the new version another holder rotated to, then reads the state again: the item keys changed without their events', async () => {
    const { unlockVault, rotateVault, refresh, snapshot, event } = setUp();
    snapshot({ version: 1, rotationPending: true });
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    rotateVault.mockClear();
    refresh.mockClear();

    event({ version: 3, rotationPending: false });
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(unlockVault).toHaveBeenCalledTimes(1);
    expect(rotateVault).not.toHaveBeenCalled();
  });

  it('tries one rotation per version: a failure is left to another holder, no loop', async () => {
    const { rotateVault, refresh, snapshot, event } = setUp({ outcome: 'unknown-holder' });
    snapshot({ version: 1, rotationPending: true });
    await vi.waitFor(() => expect(rotateVault).toHaveBeenCalledTimes(1));
    event({ version: 1, rotationPending: true });
    event({ version: 1, rotationPending: true });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(rotateVault).toHaveBeenCalledTimes(1);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('does not rotate from an Appareil not trusted, nor from a locked vault', async () => {
    const pending = setUp();
    pending.snapshot({ version: 1, rotationPending: true }, 'pending');
    const locked = setUp();
    locked.store.setVaultState('locked');
    locked.snapshot({ version: 1, rotationPending: true });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(pending.rotateVault).not.toHaveBeenCalled();
    expect(locked.rotateVault).not.toHaveBeenCalled();
  });

  it('stops following', async () => {
    const { rotateVault, stop, snapshot } = setUp();
    stop();
    snapshot({ version: 1, rotationPending: true });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(rotateVault).not.toHaveBeenCalled();
  });
});
