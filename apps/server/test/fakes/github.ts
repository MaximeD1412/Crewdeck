import { createHmac, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { GitHubClient } from '../../src/github/github.client.js';
import { FakeGitHub as BaseFakeGitHub } from '../../src/testing/fake-github.js';

export type { FakeCall, FakePullRequestFile, FileContent, SeedIssue, SeedRepo } from '../../src/testing/fake-github.js';

/** The fake GitHub of `src/testing/`, with what a unit test asserts on it. */
export class FakeGitHub extends BaseFakeGitHub {
  /** Asserts `method` was called with exactly `args`, at least once. */
  expectCalled<M extends keyof GitHubClient>(method: M, args: Parameters<GitHubClient[M]>): void {
    expect(this.calls).toContainEqual({ method, args });
  }

  /** Asserts `method` was never called. */
  expectNotCalled(method: keyof GitHubClient): void {
    expect(this.calls.map((call) => call.method)).not.toContain(method);
  }
}

/** The webhook secret of the tests: made up, never an App's. */
export const TEST_WEBHOOK_SECRET = 'test-webhook-secret-not-a-real-one';

/** `X-Hub-Signature-256` of `body` as GitHub computes it: `sha256=` and the HMAC-SHA256 of the raw body in hex. */
export const signWebhook = (body: string | Buffer, secret: string = TEST_WEBHOOK_SECRET): string =>
  `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;

/** The payload of `test/fixtures/webhooks/<name>.json`, parsed: a test changes what it needs before sending it. */
export const webhookFixture = <T = Record<string, unknown>>(name: string): T =>
  JSON.parse(readFileSync(join(import.meta.dirname, '../fixtures/webhooks', `${name}.json`), 'utf8')) as T;

export interface WebhookDelivery {
  readonly event: string;
  readonly payload: unknown;
  /** `X-GitHub-Delivery`, a new UUID unless given (a redelivery reuses it). */
  readonly deliveryId?: string;
  /** The secret it is signed with, the tests' unless given. */
  readonly secret?: string;
  /** `X-Hub-Signature-256` as is, in place of the right one (`null`: none). */
  readonly signature?: string | null;
}

/** POSTs a delivery to `<url>/api/github/webhooks` as GitHub does: the JSON body, signed, with its event and delivery id. */
export const deliverWebhook = (url: string, { event, payload, deliveryId = randomUUID(), secret, signature }: WebhookDelivery): Promise<Response> => {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'user-agent': 'GitHub-Hookshot/test',
    'x-github-event': event,
    'x-github-delivery': deliveryId,
    'x-github-hook-id': '81000001',
  };
  const signed = signature === undefined ? signWebhook(body, secret) : signature;
  if (signed !== null) headers['x-hub-signature-256'] = signed;
  return fetch(`${url}/api/github/webhooks`, { method: 'POST', headers, body });
};
