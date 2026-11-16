import type { PinoLogger } from 'nestjs-pino';
import webpush from 'web-push';
import { PUSH_CLAIM_MS } from './push-delivery.js';
import { PUSH_SEND_TIMEOUT_MS, WebPushSender } from './push-sender.js';
import type { PushTarget } from './push-subscriptions.js';

const VAPID = { publicKey: 'B'.padEnd(87, 'A'), privateKey: 'A'.repeat(43), subject: 'mailto:pilote@example.invalid' };
const logger = { warn: vi.fn() } as unknown as PinoLogger;
const PAYLOAD = { title: 'Ticket bloqué · #42', url: '/boucle?ticket=42', tag: 'decisions' };

const target = (endpoint: string): PushTarget => ({ id: '019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6a01', endpoint, p256dh: 'B'.padEnd(87, 'A'), auth: 'A'.repeat(22) });

describe('WebPushSender', () => {
  afterEach(() => vi.restoreAllMocks());

  it('sends to a browser’s push service', async () => {
    const send = vi.spyOn(webpush, 'sendNotification').mockResolvedValue({ statusCode: 201, body: '', headers: {} });
    expect(await new WebPushSender(VAPID, logger).send(target('https://fcm.googleapis.com/fcm/send/abc'), PAYLOAD)).toBe('sent');
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('gives up on a push service silent for 30 seconds, long before the claim of its push lapses', async () => {
    const send = vi.spyOn(webpush, 'sendNotification').mockResolvedValue({ statusCode: 201, body: '', headers: {} });
    await new WebPushSender(VAPID, logger).send(target('https://fcm.googleapis.com/fcm/send/abc'), PAYLOAD);
    expect(send.mock.calls[0]?.[2]).toMatchObject({ timeout: 30_000 });
    expect(PUSH_SEND_TIMEOUT_MS * 2).toBeLessThan(PUSH_CLAIM_MS);
  });

  it.each(['https://127.0.0.1:8443/internal', 'https://push.invalid/abc'])('never sends a request to what is no push service, the subscription gone: %s', async (endpoint) => {
    const send = vi.spyOn(webpush, 'sendNotification');
    expect(await new WebPushSender(VAPID, logger).send(target(endpoint), PAYLOAD)).toBe('gone');
    expect(send).not.toHaveBeenCalled();
  });

  it('says a subscription its push service no longer knows is gone, another refusal failed', async () => {
    const sender = new WebPushSender(VAPID, logger);
    const endpoint = 'https://web.push.apple.com/QGx1';
    vi.spyOn(webpush, 'sendNotification').mockRejectedValueOnce(new webpush.WebPushError('gone', 410, {}, '', endpoint));
    expect(await sender.send(target(endpoint), PAYLOAD)).toBe('gone');
    vi.spyOn(webpush, 'sendNotification').mockRejectedValueOnce(new webpush.WebPushError('unavailable', 503, {}, '', endpoint));
    expect(await sender.send(target(endpoint), PAYLOAD)).toBe('failed');
  });
});
