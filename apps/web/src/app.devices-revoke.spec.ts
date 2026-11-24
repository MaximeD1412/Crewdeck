import { DEFAULT_ACCOUNT_SETTINGS, type Device, type Me } from '@crewdeck/contracts';
import { Banner, t } from '@crewdeck/sdk';
import { createDispatcher } from './actions/dispatcher.js';
import { ApiError, setCurrentDevice } from './api/request.js';
import { boot, type App } from './app.js';
import { CONFIRM_TAG } from './dialogs/confirm.js';
import type { PageKeys } from './keys/index.js';
import { createStore } from './store/store.js';
import { revokeDeviceId } from './views/devices.js';

const PILOT: Me = { id: '018f6b2a-7c3d-7e4f-9a1b-2c3d4e5f6a7b', displayName: 'octocat', avatarUrl: null, timeZone: 'Europe/Paris', gettingStartedStep: 'done', identities: [], githubLinked: false };
/** This browser's Appareil, the only one trusted. */
const TRUSTED: Device = {
  id: '018f6b2a-7c3d-7e4f-9a1b-2c3d4e5f6a74',
  name: 'Firefox sur Linux',
  state: 'trusted',
  approvedAt: '2026-11-03T09:00:00.000Z',
  revokedAt: null,
  lastSeenAt: null,
  current: true,
};

const store = createStore();
store.registerSlice('pilot', { shape: 'single' });
store.registerSlice('device', { shape: 'collection', snapshotKey: 'devices' });
store.registerSlice('settings', { shape: 'single' });
store.registerSlice('vault', { shape: 'single' });
const command = vi.fn(async () => undefined);
/** What `PageKeys.forgetDevice` does: its record cleared, the API no longer named, the vault without an Appareil. */
const forgetDevice = vi.fn(async () => {
  setCurrentDevice(null);
  store.setVaultState('no-device');
});
let app: App;
let root: HTMLElement;

/** The core's confirmation, open. */
const confirmation = () =>
  vi.waitFor(() => {
    const found = document.querySelector(CONFIRM_TAG);
    if (!found?.shadowRoot?.querySelector('dialog')?.open) throw new Error('no crewdeck-confirm open');
    return found.shadowRoot;
  });
const button = (shadow: ShadowRoot, label: string) => {
  const found = [...shadow.querySelectorAll('button')].find((b) => b.textContent?.trim() === label);
  if (!found) throw new Error(`no button ${label}`);
  return found;
};
/** Another Appareil of the Pilote, trusted. */
const OTHER: Device = { ...TRUSTED, id: '018f6b2a-7c3d-7e4f-9a1b-2c3d4e5f6a75', name: 'Safari sur iPhone', current: false };
const retirer = (id = TRUSTED.id) => root.querySelector<HTMLElement>(`cd-page-parametres > cd-card[slot=devices] #${revokeDeviceId(id)}`) as HTMLElement;

// Its own file: a page has one Skin, booted once.
beforeAll(async () => {
  history.replaceState(null, '', '/parametres');
  root = document.createElement('div');
  document.body.append(root);
  app = await boot({
    root,
    dispatcher: createDispatcher(),
    me: async () => PILOT,
    store,
    connection: { start: vi.fn<() => void>(), stop: vi.fn<() => void>(), refresh: vi.fn<() => void>() },
    client: { command, query: vi.fn() },
    keys: {
      linkKeys: { browserPairing: vi.fn(), adoptDevice: vi.fn(), confirmPairing: vi.fn() },
      vault: { sealItem: vi.fn(), openItem: vi.fn(), version: () => 1 } as unknown as PageKeys['vault'],
      nameDevice: async () => setCurrentDevice(TRUSTED.id),
      unlockVault: async () => {
        store.setVaultState('unlocked');
        return 'unlocked' as const;
      },
      approval: { register: vi.fn(), adopt: vi.fn(), check: vi.fn(), approve: vi.fn() },
      rotateVault: vi.fn(async () => 'not-pending' as const),
      forgetDevice,
    },
  });
  store.applySnapshot({ seq: 1, pilot: PILOT, runner: null, 'runner-link': null, 'ai-account': [], 'mcp-server': [], devices: [TRUSTED], 'push-subscriptions': [], vault: { version: 1, rotationPending: false }, sourceMigrations: [], settings: { ...DEFAULT_ACCOUNT_SETTINGS, timeZone: 'Europe/Paris', projects: [] }, projects: [], processes: [], processTemplates: [], phaseRuns: [], stepRuns: [], repositories: [], decisions: [], ideas: [], tickets: [], milestones: [], codeChanges: [], sessions: [], usage: [] });
  await vi.waitFor(() => expect(store.getState().vaultState).toBe('unlocked'));
});
afterAll(() => app.stop());

describe('« Retirer » an Appareil on /parametres (E2E-4)', () => {
  it('cancelled, sends nothing', async () => {
    retirer().click();
    button(await confirmation(), t('confirm.cancel')).click();
    await vi.waitFor(() => expect(document.querySelector(CONFIRM_TAG)).toBeNull());
    expect(command).not.toHaveBeenCalled();
    expect(forgetDevice).not.toHaveBeenCalled();
  });

  it('another one, left the last trusted one meanwhile by another page: 409 devices.last-changed, the dialog again with the warning, then sent with it', async () => {
    store.applyEvent({ seq: 2, type: 'device.upserted', payload: OTHER, at: '2026-11-19T09:00:00.000Z' });
    command.mockRejectedValueOnce(new ApiError({ status: 409, code: 'devices.last-changed', message: 'C’est maintenant ton dernier Appareil de confiance.' }));
    await vi.waitFor(() => expect(retirer(OTHER.id)).not.toBeNull());
    retirer(OTHER.id).click();
    const first = await confirmation();
    expect(first.textContent).not.toContain(t('devices.revoke.last'));
    button(first, t('devices.revoke.confirm')).click();
    await vi.waitFor(() => expect(command).toHaveBeenCalledTimes(1));
    expect(command).toHaveBeenLastCalledWith('POST', `/api/devices/${OTHER.id}/revoke`, { last: false });

    await vi.waitFor(async () => expect((await confirmation()).textContent).toContain(t('devices.revoke.last')));
    button(await confirmation(), t('devices.revoke.confirm')).click();
    await vi.waitFor(() => expect(command).toHaveBeenCalledTimes(2));
    expect(command).toHaveBeenLastCalledWith('POST', `/api/devices/${OTHER.id}/revoke`, { last: true });
    expect(forgetDevice).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(document.querySelector(CONFIRM_TAG)).toBeNull());
    store.applyEvent({ seq: 3, type: 'device.upserted', payload: { ...OTHER, state: 'revoked' }, at: '2026-11-19T09:00:00.000Z' });
    command.mockClear();
  });

  it('this browser’s, the last trusted one: the warning first, then the revocation, its keys forgotten and the Banner back', async () => {
    expect(root.querySelector(`${Banner.tag}[slot=banner]`)).toBeNull();
    retirer().click();

    // The core's dialog, a product's action, says what happens before anything is sent.
    const shadow = await confirmation();
    expect(shadow.querySelector('.mark')?.textContent?.trim()).toBe(t('confirm.mark.product'));
    expect(shadow.querySelector('h2')?.textContent).toBe(t('devices.revoke.title', { name: TRUSTED.name }));
    expect(shadow.textContent).toContain(t('devices.revoke.last'));
    expect(shadow.textContent).toContain(t('devices.revoke.current.strong'));
    expect(command).not.toHaveBeenCalled();

    button(shadow, t('devices.revoke.confirm')).click();
    await vi.waitFor(() => expect(forgetDevice).toHaveBeenCalledTimes(1));
    // The store's `seq`, `client.command`'s default.
    expect(command).toHaveBeenCalledExactlyOnceWith('POST', `/api/devices/${TRUSTED.id}/revoke`, { last: true });
    expect(store.getState().vaultState).toBe('no-device');
    await vi.waitFor(() => expect(root.querySelector(`${Banner.tag}[slot=banner]`)).not.toBeNull());
  });
});
