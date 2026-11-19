/**
 * What the service worker does (`src/sw.ts`, ATOI-4), apart from its global
 * scope so that it can be tested: show the push the server sent, then open
 * its page when the Pilote taps it. No import beyond types: the worker is one
 * classic script of its own (`vite.config.ts`).
 */
import type { PushPayload } from '@crewdeck/contracts';

/** The icon of every notification, from `public/icons/`. */
export const NOTIFICATION_ICON = '/icons/icon-192.png';

/** The parts of a notification the worker shows: the payload's title, its page and its tag. */
export interface ShownNotification {
  readonly title: string;
  readonly options: { readonly body?: string; readonly tag: string; readonly icon: string; readonly data: { readonly url: string } };
}

const isPayload = (value: unknown): value is PushPayload => {
  if (typeof value !== 'object' || value === null) return false;
  const { title, url, tag } = value as Record<string, unknown>;
  return typeof title === 'string' && title !== '' && typeof url === 'string' && url.startsWith('/') && typeof tag === 'string' && tag !== '';
};

const parsed = (text: string | null): unknown => {
  try {
    return text === null ? null : (JSON.parse(text) as unknown);
  } catch {
    return null;
  }
};

/**
 * The notification of a push's text, `{ title, url, tag }` (ADR 0003, no
 * other text): its tag replaces the earlier one of the same Décision or
 * batch. A push the worker cannot read still shows « Crewdeck » at « À toi »,
 * as a browser requires of every push (`userVisibleOnly`).
 */
export const notificationOf = (text: string | null): ShownNotification => {
  const payload = parsed(text);
  const { title, url, tag } = isPayload(payload) ? payload : { title: 'Crewdeck', url: '/a-toi', tag: 'crewdeck' };
  return { title, options: { tag, icon: NOTIFICATION_ICON, data: { url } } };
};

/** The page a tapped notification opens, on the worker's origin only. */
export const urlOf = (data: unknown, origin: string): string => {
  const url = typeof data === 'object' && data !== null ? (data as { url?: unknown }).url : undefined;
  const target = new URL(typeof url === 'string' && url.startsWith('/') ? url : '/a-toi', origin);
  return target.origin === origin ? target.href : new URL('/a-toi', origin).href;
};

/** A window of Crewdeck, as `clients.matchAll` gives it. */
export interface WindowLike {
  readonly url: string;
  focus(): Promise<WindowLike>;
  navigate(url: string): Promise<WindowLike | null>;
}

/** The worker's `clients`, what a tap needs of them. */
export interface ClientsLike {
  matchAll(options: { type: 'window'; includeUncontrolled: boolean }): Promise<readonly WindowLike[]>;
  openWindow(url: string): Promise<unknown>;
}

/** A tap: a Crewdeck window already open is focused and led to the page, else one opens there. */
export const openPage = async (clients: ClientsLike, url: string): Promise<void> => {
  const origin = new URL(url).origin;
  const open = (await clients.matchAll({ type: 'window', includeUncontrolled: true })).find((client) => new URL(client.url).origin === origin);
  if (!open) {
    await clients.openWindow(url);
    return;
  }
  const focused = await open.focus();
  if (focused.url !== url) await focused.navigate(url).catch(() => clients.openWindow(url));
};
