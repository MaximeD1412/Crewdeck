/**
 * The page's service worker (ATOI-4, US-18), served at `/sw.js` with the
 * whole page as its scope: it shows the pushes and opens their page. No
 * `fetch` handler: the page works online only, as before.
 */
import { notificationOf, openPage, urlOf, type ClientsLike } from './sw/handlers.js';

/** What of `ServiceWorkerGlobalScope` the worker uses (the page's `lib` is the DOM's). */
interface WorkerScope {
  readonly location: Location;
  readonly clients: ClientsLike;
  readonly registration: { showNotification(title: string, options: NotificationOptions): Promise<void> };
  addEventListener(type: 'push', listener: (event: ExtendableEvent & { readonly data: { text(): string } | null }) => void): void;
  addEventListener(type: 'notificationclick', listener: (event: ExtendableEvent & { readonly notification: Notification }) => void): void;
}
interface ExtendableEvent extends Event {
  waitUntil(promise: Promise<unknown>): void;
}

const worker = self as unknown as WorkerScope;

worker.addEventListener('push', (event) => {
  const { title, options } = notificationOf(event.data?.text() ?? null);
  event.waitUntil(worker.registration.showNotification(title, options));
});

worker.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(openPage(worker.clients, urlOf(event.notification.data, worker.location.origin)));
});
