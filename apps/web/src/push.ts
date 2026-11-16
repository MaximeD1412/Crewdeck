import { PUSH_LABEL_MAX, type PushSubscriptionInput } from '@crewdeck/contracts';
import { t } from '@crewdeck/sdk';
import { fromBase64Url } from './keys/bytes.js';
import { browserOf } from './keys/pairing.js';

/** The URL of the service worker (`src/sw.ts`, its own entry of the build), at the scope of the whole page. */
export const SERVICE_WORKER_URL = '/sw.js';

type PushSystem = 'iphone' | 'ipad' | 'android' | 'windows' | 'macos' | 'linux' | 'other';

const pushSystemOf = (ua: string): PushSystem =>
  /iPhone|iPod/.test(ua)
    ? 'iphone'
    : /iPad/.test(ua)
      ? 'ipad'
      : /Android/.test(ua)
        ? 'android'
        : /Windows/.test(ua)
          ? 'windows'
          : /Macintosh|Mac OS X/.test(ua)
            ? 'macos'
            : /Linux|X11|CrOS/.test(ua)
              ? 'linux'
              : 'other';

/** The label of this browser's subscription, from its user agent, never sent elsewhere: « Safari · iPhone ». */
export const pushLabelOf = (userAgent: string): string =>
  t('push.label', { browser: t(`keys.deviceName.browser.${browserOf(userAgent)}`), system: t(`push.system.${pushSystemOf(userAgent)}`) }).slice(0, PUSH_LABEL_MAX);

/** What this browser's `subscribe` gives: the subscription for `POST /api/push-subscriptions`, or the permission refused. */
export type PushSubscribed = Omit<PushSubscriptionInput, 'label'> | 'denied';

/** This browser's push (ATOI-4): whether it can receive any, its subscription, the way to subscribe. */
export interface PushDevice {
  /** No `PushManager` (an iPhone outside the home-screen app, an old browser): the help instead of the button. */
  readonly available: boolean;
  /** The endpoint this browser receives on, `null` when it is not subscribed. */
  endpoint(): Promise<string | null>;
  /** Asks the permission, then subscribes with the server's VAPID key (`userVisibleOnly`). */
  subscribe(applicationServerKey: string): Promise<PushSubscribed>;
  /** Unsubscribes this browser, its row removed. */
  unsubscribe(): Promise<void>;
}

/** Whether `window` can receive a push: a service worker, `PushManager`, `Notification`; on iOS only as the home-screen app. */
export const canPush = (window: Window): boolean => {
  const { navigator } = window;
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return false;
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const standalone = (navigator as Navigator & { standalone?: boolean }).standalone === true || window.matchMedia('(display-mode: standalone)').matches;
  return !ios || standalone;
};

/** The page's service worker, registered once at boot when the browser can push. */
export const registerServiceWorker = (window: Window): void => {
  if (!canPush(window)) return;
  // Vite serves the worker as a module in development (`vite.config.ts`), the build as one classic script.
  void window.navigator.serviceWorker.register(SERVICE_WORKER_URL, { scope: '/', type: import.meta.env.DEV ? 'module' : 'classic' }).catch(() => undefined);
};

/** This browser's push, through its service worker's registration. */
export const createBrowserPush = (window: Window): PushDevice => {
  const available = canPush(window);
  const registration = () => window.navigator.serviceWorker.ready;
  const current = async () => (available ? await (await registration()).pushManager.getSubscription() : null);
  return {
    available,
    endpoint: async () => (await current())?.endpoint ?? null,
    async subscribe(applicationServerKey) {
      if ((await (window as Window & typeof globalThis).Notification.requestPermission()) !== 'granted') return 'denied';
      const subscription = await (await registration()).pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: fromBase64Url(applicationServerKey),
      });
      const { keys } = subscription.toJSON();
      return { endpoint: subscription.endpoint, keys: { p256dh: keys?.['p256dh'] ?? '', auth: keys?.['auth'] ?? '' } };
    },
    async unsubscribe() {
      await (await current())?.unsubscribe();
    },
  };
};
