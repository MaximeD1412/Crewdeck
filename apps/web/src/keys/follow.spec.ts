import type { Device, VaultState as VaultSlice } from '@crewdeck/contracts';
import { createStore } from '../store/store.js';
import { followVault } from './follow.js';
import type { RotationOutcome } from './rotation.js';

const SELF = '019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6a01';
const AT = '2026-11-19T09:00:00.000Z';
const device = (state: Device['state']): Device => ({ id: SELF, name: 'Firefox sur Linux', state, approvedAt: AT, revokedAt: null, lastSeenAt: null, current: false });

const setUp = ({ held = 1, outcome = 'rotated' as RotationOutcome, locked = false } = {}) => {
  const store = createStore();
  store.registerSlice('device', { shape: 'collection', snapshotKey: 'devices' });
  store.registerSlice('vault', { shape: 'single' });
  let version: number | null = locked ? null : held;
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
  const forgetDevice = vi.fn(async () => undefined);
  store.setVaultState(locked ? 'locked' : 'unlocked');
  const stop = followVault({ store, vault: { version: () => version }, unlockVault, rotateVault, refresh, forgetDevice, currentDeviceId: () => SELF });
  let seq = 1;
  const snapshot = (vault: VaultSlice, state: Device['state'] = 'trusted') =>
    store.applySnapshot({ seq: seq++, devices: [device(state)], vault } as never);
  const event = (vault: VaultSlice) => store.applyEvent({ seq: seq++, type: 'vault.upserted', payload: vault, at: AT });
  const revoked = () => store.applyEvent({ seq: seq++, type: 'device.upserted', payload: device('revoked'), at: AT });
  /** The vault opened at `next` by another of the page's paths (a sealed write's 409). */
  const adopt = (next: number) => {
    version = next;
  };
  return { store, unlockVault, rotateVault, refresh, forgetDevice, stop, snapshot, event, revoked, adopt };
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

  it('reads the state again once the page opened a new version on its own (a sealed write’s 409 before vault.upserted): its items still under the old key', async () => {
    const { unlockVault, refresh, snapshot, event, adopt } = setUp();
    snapshot({ version: 1, rotationPending: false });
    expect(refresh).not.toHaveBeenCalled();

    adopt(2);
    event({ version: 2, rotationPending: false });
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(unlockVault).not.toHaveBeenCalled();

    // Once only for that version.
    snapshot({ version: 2, rotationPending: false });
    await Promise.resolve();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('reads the state again when its first unlock opens a newer version than the snapshot read while locked (a rotation meanwhile)', async () => {
    const { store, unlockVault, refresh, snapshot, event, adopt } = setUp({ locked: true });
    snapshot({ version: 1, rotationPending: false });
    expect(refresh).not.toHaveBeenCalled();

    // The boot's unlock answered with the new version, its vault.upserted later.
    adopt(2);
    store.setVaultState('unlocked');
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));

    event({ version: 2, rotationPending: false });
    await Promise.resolve();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(unlockVault).not.toHaveBeenCalled();
  });

  it('reads nothing again when its first unlock opens the version of the snapshot', async () => {
    const { store, refresh, snapshot, adopt } = setUp({ locked: true });
    snapshot({ version: 2, rotationPending: false });
    adopt(2);
    store.setVaultState('unlocked');
    await Promise.resolve();
    expect(refresh).not.toHaveBeenCalled();
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

  it('forgets this Appareil once it is revoked from another page, its vault open or not, and once only', async () => {
    const { forgetDevice, rotateVault, snapshot, revoked } = setUp();
    snapshot({ version: 1, rotationPending: false });
    expect(forgetDevice).not.toHaveBeenCalled();

    revoked();
    await vi.waitFor(() => expect(forgetDevice).toHaveBeenCalledTimes(1));
    revoked();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(forgetDevice).toHaveBeenCalledTimes(1);
    expect(rotateVault).not.toHaveBeenCalled();

    const locked = setUp();
    locked.store.setVaultState('locked');
    locked.snapshot({ version: 1, rotationPending: true }, 'revoked');
    await vi.waitFor(() => expect(locked.forgetDevice).toHaveBeenCalledTimes(1));
  });

  it('stops following', async () => {
    const { rotateVault, stop, snapshot } = setUp();
    stop();
    snapshot({ version: 1, rotationPending: true });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(rotateVault).not.toHaveBeenCalled();
  });
});
