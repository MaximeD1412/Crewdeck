import type { Store } from '../store/store.js';
import type { RotationOutcome } from './rotation.js';
import type { Vault, VaultState } from './vault.js';

export interface VaultFollowOptions {
  readonly store: Pick<Store, 'getState' | 'subscribe'>;
  readonly vault: Pick<Vault, 'version'>;
  /** The page's unlock: its state goes to the store. */
  readonly unlockVault: () => Promise<VaultState>;
  readonly rotateVault: () => Promise<RotationOutcome>;
  /** The store's Resynchronisation from `GET /api/state` (`connection.refresh`). */
  readonly refresh: () => void;
  /** This page's Appareil (`X-Crewdeck-Device`). */
  readonly currentDeviceId: () => string | null;
}

/**
 * The page follows the `vault` slice (E2E-4):
 *
 * - its version moved past the one this page holds (another holder rotated):
 *   the page opens its wrap of the new version, then reads the state again,
 *   since every item key was rewrapped without an event of its own;
 * - a rotation pending, this Appareil trusted and its vault open at the
 *   current version: it rotates, one at a time, once per version (a failure
 *   leaves it to another holder, never a loop), then reads the state again.
 *
 * Returns the function that stops.
 */
export const followVault = ({ store, vault, unlockVault, rotateVault, refresh, currentDeviceId }: VaultFollowOptions): (() => void) => {
  let busy = false;
  /** The last version reopened, and the last one this page tried to rotate from. */
  let reopened: number | null = null;
  let tried: number | null = null;

  const run = (work: () => Promise<boolean>) => {
    busy = true;
    void work()
      .then((changed) => {
        if (changed) refresh();
      })
      .catch(() => undefined)
      .finally(() => {
        busy = false;
        check();
      });
  };

  const check = () => {
    if (busy) return;
    const { slices, vaultState } = store.getState();
    const slice = slices.vault;
    if (!slice || vaultState !== 'unlocked') return;
    const held = vault.version();
    if (held === null) return;
    if (slice.version > held) {
      if (reopened === slice.version) return;
      reopened = slice.version;
      return run(async () => (await unlockVault()) === 'unlocked');
    }
    const device = slices.device?.get(currentDeviceId() ?? '');
    if (!slice.rotationPending || slice.version !== held || device?.state !== 'trusted' || tried === slice.version) return;
    tried = slice.version;
    run(async () => (await rotateVault()) === 'rotated');
  };

  const stop = store.subscribe(check);
  check();
  return stop;
};
