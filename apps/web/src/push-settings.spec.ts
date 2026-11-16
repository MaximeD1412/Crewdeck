import { DEFAULT_ACCOUNT_SETTINGS, type PushSubscription } from '@crewdeck/contracts';
import { t } from '@crewdeck/sdk';
import type { Client } from './api/client.js';
import { ApiError } from './api/request.js';
import type { PushDevice, PushSubscribed } from './push.js';
import { createPushSettings } from './push-settings.js';

const KEY = 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U';
const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/abc';
const SUBSCRIBED: PushSubscribed = {
  endpoint: ENDPOINT,
  keys: { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', auth: 'tBHItJI5svbpez7KI4CCXg' },
};
const CHROME_WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const ROW: PushSubscription = { id: '019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6a02', endpoint: ENDPOINT, label: 'Chrome · Windows', createdAt: '2026-11-12T09:00:00.000Z' };
const OTHER: PushSubscription = { ...ROW, id: '019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6a01', endpoint: 'https://web.push.apple.com/QGx1', label: 'Safari · iPhone' };

const refused = (status: number, code: string, message: string) => new ApiError({ status, code, message });

const setup = ({
  available = true,
  endpoint = null as string | null,
  subscribe = async (): Promise<PushSubscribed> => SUBSCRIBED,
  command = async (): Promise<unknown> => ROW,
  config = async (): Promise<unknown> => ({ vapidPublicKey: KEY }),
} = {}) => {
  let current = endpoint;
  const device = {
    available,
    endpoint: vi.fn(async () => current),
    subscribe: vi.fn(async (key: Promise<string>) => {
      const answer = await subscribe();
      if (answer !== 'denied') current = answer.endpoint;
      await key;
      return answer;
    }),
    unsubscribe: vi.fn(async () => {
      current = null;
    }),
  } satisfies PushDevice;
  const commands = vi.fn<(...args: unknown[]) => Promise<unknown>>(command);
  const query = vi.fn<(...args: unknown[]) => Promise<unknown>>(config);
  const rows = new Map([ROW, OTHER].map((row) => [row.id, row]));
  const push = createPushSettings({
    client: { command: commands as unknown as Client['command'], query: query as unknown as Client['query'] },
    device,
    userAgent: CHROME_WINDOWS,
    subscriptionOf: (id) => rows.get(id),
  });
  const changes = vi.fn<() => void>();
  push.subscribe(changes);
  return { push, device, commands, query, changes };
};

describe('createPushSettings', () => {
  it('knows whether this browser can push and, once synced, the endpoint it receives on', async () => {
    const { push, changes } = setup({ endpoint: ENDPOINT });
    expect(push.view()).toEqual({ available: true, endpoint: null, pushing: null, busy: false, error: null });
    await push.sync();
    expect(push.view().endpoint).toBe(ENDPOINT);
    expect(changes).toHaveBeenCalledTimes(1);
    expect(setup({ available: false }).push.view().available).toBe(false);
  });

  it('switches the account’s push with PATCH /api/settings, shown on its way until the store has it', async () => {
    const { push, commands } = setup({ command: async () => DEFAULT_ACCOUNT_SETTINGS });
    await push.toggle(true);
    expect(commands).toHaveBeenCalledWith('PATCH', '/api/settings', { notifications: { push: true } }, expect.anything());
    expect(push.view().pushing).toBe(true);
    push.settled(false);
    expect(push.view().pushing).toBe(true);
    push.settled(true);
    expect(push.view().pushing).toBeNull();
  });

  it('puts the Toggle back and says why when the account’s push could not be switched', async () => {
    const { push } = setup({ command: async () => Promise.reject(refused(409, 'realtime.stale', 'La page n’était plus à jour : réessaie.')) });
    await push.toggle(true);
    expect(push.view()).toMatchObject({ pushing: null, error: 'La page n’était plus à jour : réessaie.' });

    const offline = setup({ command: async () => Promise.reject(new TypeError('Failed to fetch')) });
    await offline.push.toggle(true);
    expect(offline.push.view()).toMatchObject({ pushing: null, error: t('settings.notifications.push.failed') });
    await expect(offline.push.toggle(false)).resolves.toBeUndefined();
  });

  it('keeps the last switch on its way when an earlier one fails', async () => {
    const answers: ((error: unknown) => void)[] = [];
    const { push } = setup({ command: () => new Promise((_, reject) => answers.push(reject)) });
    const first = push.toggle(true);
    const second = push.toggle(false);
    answers[0]?.(new TypeError('Failed to fetch'));
    await first;
    expect(push.view()).toMatchObject({ pushing: false, error: null });
    answers[1]?.(new TypeError('Failed to fetch'));
    await second;
    expect(push.view()).toMatchObject({ pushing: null, error: t('settings.notifications.push.failed') });
  });

  it('activates this browser with the server’s VAPID key, then POST /api/push-subscriptions with its label, busy meanwhile', async () => {
    let answer: (value: unknown) => void = () => undefined;
    const { push, device, commands, query } = setup({ command: () => new Promise((resolve) => (answer = resolve)) });
    const subscribing = push.activate();
    expect(push.view().busy).toBe(true);
    await vi.waitFor(() => expect(commands).toHaveBeenCalled());
    expect(query).toHaveBeenCalledWith('/api/config', expect.anything());
    await expect(device.subscribe.mock.calls[0]?.[0]).resolves.toBe(KEY);
    expect(commands).toHaveBeenCalledWith('POST', '/api/push-subscriptions', { ...SUBSCRIBED, label: 'Chrome · Windows' }, expect.anything());
    push.activate();
    expect(device.subscribe).toHaveBeenCalledTimes(1);
    answer(ROW);
    await subscribing;
    expect(push.view()).toEqual({ available: true, endpoint: ENDPOINT, pushing: null, busy: false, error: null });
  });

  it('asks this browser to subscribe in the click itself, the server’s key read ahead and not waited for', async () => {
    const config = Promise.withResolvers<unknown>();
    const { push, device, query } = setup({ config: () => config.promise });
    void push.sync();
    expect(query).toHaveBeenCalledTimes(1);

    const subscribing = push.activate();

    expect(device.subscribe).toHaveBeenCalledTimes(1);
    config.resolve({ vapidPublicKey: KEY });
    await subscribing;
    await expect(device.subscribe.mock.calls[0]?.[0]).resolves.toBe(KEY);
    expect(query).toHaveBeenCalledTimes(1);
    expect(push.view()).toMatchObject({ endpoint: ENDPOINT, error: null });
  });

  it('reads the server’s key again on the next try when it could not be read', async () => {
    let calls = 0;
    const { push, query } = setup({ config: async () => (++calls === 1 ? Promise.reject(new Error('offline')) : { vapidPublicKey: KEY }) });
    await push.activate();
    expect(push.view().error).toBe(t('settings.notifications.failed'));
    await push.activate();
    expect(query).toHaveBeenCalledTimes(2);
    expect(push.view()).toMatchObject({ endpoint: ENDPOINT, error: null });
  });

  it('says the notifications are blocked when the permission is refused, and sends nothing', async () => {
    const { push, commands } = setup({ subscribe: async () => 'denied' });
    await push.activate();
    expect(push.view()).toMatchObject({ busy: false, endpoint: null, error: t('settings.notifications.denied') });
    expect(commands).not.toHaveBeenCalled();
  });

  it('says why the subscription failed: the server’s refusal, else that it failed; a new try clears it', async () => {
    const { push } = setup({ command: async () => Promise.reject(refused(409, 'push-subscription.taken', 'Ce navigateur reçoit déjà les notifications d’un autre compte.')) });
    await push.activate();
    expect(push.view()).toMatchObject({ busy: false, error: 'Ce navigateur reçoit déjà les notifications d’un autre compte.' });

    const failing = setup({ subscribe: async () => Promise.reject(new DOMException('push service', 'AbortError')) });
    await failing.push.activate();
    expect(failing.push.view().error).toBe(t('settings.notifications.failed'));
  });

  it('does nothing where this browser cannot push', async () => {
    const { push, device } = setup({ available: false });
    await push.activate();
    expect(device.subscribe).not.toHaveBeenCalled();
  });

  it('removes a browser with DELETE /api/push-subscriptions/:id, and unsubscribes this one when it is its own row', async () => {
    const { push, device, commands } = setup({ endpoint: ENDPOINT, command: async () => undefined });
    await push.sync();
    await push.remove(OTHER.id);
    expect(commands).toHaveBeenCalledWith('DELETE', `/api/push-subscriptions/${OTHER.id}`, {});
    expect(device.unsubscribe).not.toHaveBeenCalled();
    await push.remove(ROW.id);
    expect(device.unsubscribe).toHaveBeenCalledTimes(1);
    expect(push.view().endpoint).toBeNull();
  });

  it('says why a removal was refused', async () => {
    const { push, device } = setup({ endpoint: ENDPOINT, command: async () => Promise.reject(refused(404, 'push-subscription.not-found', 'Ce navigateur ne reçoit plus les notifications.')) });
    await push.sync();
    await push.remove(ROW.id);
    expect(push.view().error).toBe('Ce navigateur ne reçoit plus les notifications.');
    expect(device.unsubscribe).not.toHaveBeenCalled();
  });
});
