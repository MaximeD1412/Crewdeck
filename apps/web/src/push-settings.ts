import { type AccountSettings, zPublicConfig, type PushSubscription } from '@crewdeck/contracts';
import { t } from '@crewdeck/sdk';
import type { Client } from './api/client.js';
import { addPushSubscription, removePushSubscription } from './api/push-subscriptions.js';
import { ApiError } from './api/request.js';
import { updateSettings } from './api/settings.js';
import { pushLabelOf, type PushDevice } from './push.js';
import { NO_PUSH_LOCAL, type PushLocal } from './views/parametres.js';

export interface PushSettingsOptions {
  readonly client: Pick<Client, 'command' | 'query'>;
  /** This browser's push (`createBrowserPush`). */
  readonly device: PushDevice;
  /** This browser's user agent, for the label of its subscription. */
  readonly userAgent: string;
  /** A browser of the store's `push-subscription` slice, by id. */
  readonly subscriptionOf: (id: string) => PushSubscription | undefined;
}

export interface PushSettingsState {
  /** The page's own state of « Notifications », for `parametresView`. */
  view(): PushLocal;
  /** Reads the endpoint this browser receives on (at boot, and when its push service may have changed it), and the server's VAPID key ahead of « Activer ». */
  sync(): Promise<void>;
  /** Switches the account's push (`PATCH /api/settings`), shown on its way; refused, the Toggle back and why. */
  toggle(push: boolean): Promise<void>;
  /**
   * The store's account settings, after each change of the store: the switch
   * on its way ends once the store has its value, or, once acknowledged, as
   * soon as the store has moved on (a later change, a Resynchronisation that
   * skipped its event).
   */
  settled(settings: AccountSettings | null | undefined): void;
  /** « Activer sur cet appareil »: the permission, the subscription with the server's VAPID key, then `POST /api/push-subscriptions`; why it failed under the button. */
  activate(): Promise<void>;
  /** « Retirer » (`DELETE /api/push-subscriptions/:id`); this browser's own row unsubscribes it too. */
  remove(id: string): Promise<void>;
  /** Calls `fn` after each change of this state; returns the function that stops. */
  subscribe(fn: () => void): () => void;
}

/**
 * The page's side of the push notifications (ATOI-4): what the store does
 * not hold, this browser's subscription and why it failed. The browsers
 * themselves come back through `push-subscription.*`, the account's push
 * through `settings.upserted`.
 */
export const createPushSettings = ({ client, device, userAgent, subscriptionOf }: PushSettingsOptions): PushSettingsState => {
  const listeners = new Set<() => void>();
  let state: PushLocal = { ...NO_PUSH_LOCAL, available: device.available };

  const set = (next: Partial<PushLocal>) => {
    state = { ...state, ...next };
    for (const listener of [...listeners]) listener();
  };
  const messageOf = (error: unknown) => (error instanceof ApiError ? error.message : t('settings.notifications.failed'));
  let toggles = 0;
  // The store's settings as last seen (`settled`), and as they were when the switch on its way was acknowledged.
  let stored: AccountSettings | null | undefined;
  const PENDING = Symbol('pending');
  let acked: AccountSettings | null | undefined | typeof PENDING = PENDING;
  // The server's VAPID key, read once ahead of the click (`sync`): read again after a failure.
  let key: Promise<string> | null = null;
  const keyOf = (): Promise<string> =>
    (key ??= client.query('/api/config', zPublicConfig).then(
      ({ vapidPublicKey }) => vapidPublicKey,
      (error: unknown) => {
        key = null;
        throw error;
      },
    ));

  return {
    view: () => state,
    async sync() {
      if (!device.available) return;
      void keyOf().catch(() => undefined);
      const endpoint = await device.endpoint().catch(() => null);
      if (endpoint !== state.endpoint) set({ endpoint });
    },
    async toggle(push) {
      const mine = ++toggles;
      const before = stored;
      acked = PENDING;
      set({ pushing: push, error: null });
      try {
        await updateSettings(client, { notifications: { push } });
        if (mine !== toggles || state.pushing === null) return;
        // The store moved on while it was on its way: it has this switch, or a later one, or soon will.
        if (stored !== before) set({ pushing: null });
        else acked = stored;
      } catch (error) {
        if (mine === toggles) set({ pushing: null, error: error instanceof ApiError ? error.message : t('settings.notifications.push.failed') });
      }
    },
    settled(settings) {
      stored = settings;
      // Silent: called as the store changes, which renders the page anyway.
      if (state.pushing === null) return;
      if (settings?.notifications.push === state.pushing || (acked !== PENDING && settings !== acked)) state = { ...state, pushing: null };
    },
    async activate() {
      if (!device.available || state.busy) return;
      set({ busy: true, error: null });
      try {
        // The key not awaited here: the permission is asked in the click's user activation (Safari).
        const subscribed = await device.subscribe(keyOf());
        if (subscribed === 'denied') {
          set({ busy: false, error: t('settings.notifications.denied') });
          return;
        }
        await addPushSubscription(client, { ...subscribed, label: pushLabelOf(userAgent) });
        set({ busy: false, endpoint: subscribed.endpoint });
      } catch (error) {
        set({ busy: false, error: messageOf(error) });
      }
    },
    async remove(id) {
      const own = state.endpoint !== null && subscriptionOf(id)?.endpoint === state.endpoint;
      if (state.error !== null) set({ error: null });
      try {
        await removePushSubscription(client, id);
        if (!own) return;
        await device.unsubscribe().catch(() => undefined);
        set({ endpoint: null });
      } catch (error) {
        set({ error: messageOf(error) });
      }
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
};
