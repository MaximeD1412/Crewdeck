import type { INestApplication } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { deliverWebhook, signWebhook, TEST_WEBHOOK_SECRET, webhookFixture } from '../../../test/fakes/github.js';
import { expectEnvelope, startApp } from '../../../test/route-baseline.js';
import { parseEnv } from '../../config/env.js';
import { WEBHOOK_BODY_LIMIT } from './raw-body.js';

vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>();
  return { ...actual, timingSafeEqual: vi.fn(actual.timingSafeEqual) };
});

// Nothing listens on port 1: a request that reached the database would fail with a 500.
const env = parseEnv({ CREWDECK_ENV: 'test', DATABASE_URL: 'postgresql://crewdeck:crewdeck@127.0.0.1:1/crewdeck', GITHUB_WEBHOOK_SECRET: TEST_WEBHOOK_SECRET });

describe('POST /api/github/webhooks, its signature', () => {
  let app: INestApplication;
  let url: string;

  beforeAll(async () => {
    ({ app, url } = await startApp(env));
  });

  afterAll(() => app.close());

  beforeEach(() => {
    vi.mocked(timingSafeEqual).mockClear();
  });

  const created = webhookFixture('installation.created');

  it('answers a ping signed with the secret with 200, without a session and without storing it', async () => {
    const res = await deliverWebhook(url, { event: 'ping', payload: webhookFixture('ping') });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('refuses a delivery without X-Hub-Signature-256 with 401 github.bad-signature', async () => {
    await expectEnvelope(await deliverWebhook(url, { event: 'installation', payload: created, signature: null }), 401, 'github.bad-signature');
  });

  it.each([
    ['signed with another secret', signWebhook(JSON.stringify(created), 'another-secret')],
    ['signed for another body', signWebhook(JSON.stringify({ ...created, action: 'deleted' }))],
    ['with SHA-1', `sha1=${'0'.repeat(40)}`],
    ['without its prefix', signWebhook(JSON.stringify(created)).slice('sha256='.length)],
    ['too short', signWebhook(JSON.stringify(created)).slice(0, -2)],
    ['empty', ''],
  ])('refuses a delivery %s with 401 github.bad-signature', async (_, signature) => {
    await expectEnvelope(await deliverWebhook(url, { event: 'installation', payload: created, signature }), 401, 'github.bad-signature');
  });

  it('parses nothing before the signature: a body that is not JSON, badly signed, is a 401 and not a 400', async () => {
    await expectEnvelope(await deliverWebhook(url, { event: 'installation', payload: '{not json', signature: signWebhook('{other') }), 401, 'github.bad-signature');
  });

  it('compares the HMAC with crypto.timingSafeEqual, on the raw bytes GitHub signed', async () => {
    // Spaces and a key order of its own: the HMAC is of the bytes as received, never of a re-serialised body.
    const body = '{ "zen":  "Design for failure.",   "hook_id": 81000001 }';
    const signature = signWebhook(body);

    expect((await deliverWebhook(url, { event: 'ping', payload: body, signature })).status).toBe(200);
    expect(timingSafeEqual).toHaveBeenCalledTimes(1);
    const [expected, received] = vi.mocked(timingSafeEqual).mock.calls[0] ?? [];
    expect(Buffer.from(expected as Uint8Array).toString('hex')).toBe(signature.slice('sha256='.length));
    expect(Buffer.from(received as Uint8Array).toString('hex')).toBe(signature.slice('sha256='.length));
  });

  it('goes through timingSafeEqual for a wrong signature of the right shape too', async () => {
    const res = await deliverWebhook(url, { event: 'installation', payload: created, signature: signWebhook('another body') });

    await expectEnvelope(res, 401, 'github.bad-signature');
    expect(timingSafeEqual).toHaveBeenCalledTimes(1);
  });

  it('answers 400 to a signed delivery without its event or delivery id', async () => {
    const body = JSON.stringify(created);
    const res = await fetch(`${url}/api/github/webhooks`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': signWebhook(body) },
      body,
    });

    await expectEnvelope(res, 400, 'http.bad-request');
  });

  it('answers 413 to a body over GitHub’s 25 MB, before checking anything', async () => {
    const body = JSON.stringify({ ...created, padding: 'x'.repeat(WEBHOOK_BODY_LIMIT) });

    await expectEnvelope(await deliverWebhook(url, { event: 'installation', payload: body }), 413, 'http.bad-request');
    expect(timingSafeEqual).not.toHaveBeenCalled();
  });

  it('answers 400 to a signed body that is not JSON', async () => {
    await expectEnvelope(await deliverWebhook(url, { event: 'installation', payload: '{not json' }), 400, 'http.bad-request');
  });
});

describe('POST /api/github/webhooks, without GITHUB_WEBHOOK_SECRET', () => {
  let app: INestApplication;
  let url: string;

  beforeAll(async () => {
    ({ app, url } = await startApp(parseEnv({ CREWDECK_ENV: 'test', DATABASE_URL: 'postgresql://crewdeck:crewdeck@127.0.0.1:1/crewdeck' })));
  });

  afterAll(() => app.close());

  it('refuses every delivery, none can be signed', async () => {
    await expectEnvelope(await deliverWebhook(url, { event: 'ping', payload: webhookFixture('ping'), secret: '' }), 401, 'github.bad-signature');
  });
});
