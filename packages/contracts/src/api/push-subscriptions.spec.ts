import { eventPayloadSchema, isPushServiceEndpoint, PUSH_LABEL_MAX, zPublicConfig, zPushSubscription, zPushSubscriptionInput, zPushSubscriptionList } from '../index.js';

const INPUT = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/abc:def',
  keys: {
    p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM',
    auth: 'tBHItJI5svbpez7KI4CCXg',
  },
  label: 'Safari · iPhone',
};

const SUBSCRIPTION = {
  id: '019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6a01',
  endpoint: INPUT.endpoint,
  label: INPUT.label,
  createdAt: '2026-11-03T08:00:00.000Z',
};

describe('zPushSubscriptionInput', () => {
  it('takes what pushManager.subscribe gives and the label', () => {
    expect(zPushSubscriptionInput.parse(INPUT)).toEqual(INPUT);
  });

  it.each([
    ['an endpoint that is not https', { ...INPUT, endpoint: 'http://fcm.googleapis.com/fcm/send/abc' }, 'endpoint'],
    ['an endpoint that is no push service', { ...INPUT, endpoint: 'https://127.0.0.1:8443/internal' }, 'endpoint'],
    ['a p256dh that is not base64url', { ...INPUT, keys: { ...INPUT.keys, p256dh: `${INPUT.keys.p256dh.slice(0, -1)}=` } }, 'keys.p256dh'],
    ['an auth too short', { ...INPUT, keys: { ...INPUT.keys, auth: 'abc' } }, 'keys.auth'],
    ['a label too long', { ...INPUT, label: 'x'.repeat(PUSH_LABEL_MAX + 1) }, 'label'],
    ['an empty label', { ...INPUT, label: '  ' }, 'label'],
  ])('refuses %s', (_, input, path) => {
    const result = zPushSubscriptionInput.safeParse(input);
    expect(result.error?.issues.map((issue) => issue.path.join('.'))).toEqual([path]);
  });
});

describe('isPushServiceEndpoint', () => {
  it.each([
    'https://fcm.googleapis.com/fcm/send/abc:def',
    'https://updates.push.services.mozilla.com/wpush/v2/gAAAA',
    'https://web.push.apple.com/QGx1',
    'https://api.push.apple.com/3/device/abc',
    'https://wns2-par02p.notify.windows.com/w/?token=abc',
    'https://fcm.googleapis.com:443/fcm/send/abc',
  ])('takes the push service of a browser: %s', (endpoint) => {
    expect(isPushServiceEndpoint(endpoint)).toBe(true);
  });

  it.each([
    ['a private address', 'https://127.0.0.1:8443/internal'],
    ['a host of the network', 'https://db/'],
    ['another port of a push service', 'https://fcm.googleapis.com:8443/fcm/send/abc'],
    ['plain http', 'http://fcm.googleapis.com/fcm/send/abc'],
    ['credentials', 'https://user:secret@fcm.googleapis.com/fcm/send/abc'],
    ['a look-alike host', 'https://fcm.googleapis.com.example.org/fcm/send/abc'],
    ['a push service as credentials of another host', 'https://fcm.googleapis.com@evil.example/fcm/send/abc'],
    ['a backslash, which URL reads as a slash', 'https://evil.example\\@fcm.googleapis.com/fcm/send/abc'],
    ['a tab, which URL drops', 'https://fcm.googleapis.com\t.evil.example/fcm/send/abc'],
    ['an upper-case host', 'https://FCM.googleapis.com/fcm/send/abc'],
    ['a host ending like one', 'https://evilnotify.windows.com/w'],
    ['the domain of a push service itself', 'https://push.apple.com/'],
    ['what is no URL', 'fcm.googleapis.com/fcm/send/abc'],
  ])('refuses %s', (_, endpoint) => {
    expect(isPushServiceEndpoint(endpoint)).toBe(false);
  });
});

describe('zPushSubscription', () => {
  it('is an item of GET /api/push-subscriptions and the payload of push-subscription.upserted, without the keys', () => {
    expect(zPushSubscriptionList.parse({ items: [SUBSCRIPTION] })).toEqual({ items: [SUBSCRIPTION] });
    expect(eventPayloadSchema('push-subscription.upserted')?.parse(SUBSCRIPTION)).toEqual(SUBSCRIPTION);
    expect(zPushSubscription.parse({ ...SUBSCRIPTION, keys: INPUT.keys })).not.toHaveProperty('keys');
  });
});

describe('zPublicConfig', () => {
  it('gives the VAPID public key', () => {
    const config = { githubApiUrl: 'https://api.github.com', githubWebUrl: 'https://github.com', appSlug: 'crewdeck', runnerServer: null };
    expect(zPublicConfig.safeParse(config).success).toBe(false);
    expect(zPublicConfig.parse({ ...config, vapidPublicKey: INPUT.keys.p256dh })).toMatchObject({ vapidPublicKey: INPUT.keys.p256dh });
  });
});
