import type { INestApplication } from '@nestjs/common';
import { CROCKFORD_ALPHABET, zAgentSession, zRunnerLinkAccepted, zRunnerLinkStatus, zScenarioRun } from '@crewdeck/contracts';
import { generateKeyPairSync } from 'node:crypto';
import { inject } from 'vitest';
import { createApp } from '../../src/app.js';
import { type Env, parseEnv } from '../../src/config/env.js';
import { pairingProof } from '../fakes/pairing.js';
import { expectEnvelope } from '../route-baseline.js';

const databaseUrl = inject('databaseUrl');

const boot = async (nodeEnv: Env['NODE_ENV'], fakes: boolean): Promise<INestApplication> => {
  const env = parseEnv({ CREWDECK_ENV: 'test', NODE_ENV: nodeEnv, DATABASE_URL: databaseUrl, ...(fakes ? { CREWDECK_FAKES: '1' } : {}) });
  const app = await createApp(env, { logs: false });
  await app.listen(0, '127.0.0.1');
  return app;
};

const MACHINE = { machine: 'smoke', os: 'linux', arch: 'amd64', wsl: false, runnerVersion: '0.0.0-smoke', engines: ['claude'] } as const;

/** The bytes of a Crockford base32 text, as `crewdeck-runner link` reads the secret of its code. */
const unbase32 = (text: string): Buffer => {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of text) {
    value = ((value << 5) | CROCKFORD_ALPHABET.indexOf(char)) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
};

describe('the smoke test’s helpers against PostgreSQL (RUNNER-14)', () => {
  let app: INestApplication;
  let url: string;

  const post = (path: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> =>
    fetch(`${url}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

  const scenario = async () => zScenarioRun.parse(await (await post('/api/testing/scenarios/smoke', {})).json());

  /** The binary's side up to `pending`, with a proof made of `secret`. */
  const linkAndPair = async (shortId: string, secret: Uint8Array) => {
    const res = await post('/api/runner/link', { ...MACHINE, shortId });
    expect(res.status).toBe(202);
    const { linkId, browserPairing } = zRunnerLinkAccepted.parse(await res.json());
    const runnerPublicKey = generateKeyPairSync('x25519').publicKey.export({ format: 'jwk' }).x ?? '';
    const proof = pairingProof('runner', secret, shortId, runnerPublicKey, browserPairing.devicePublicKey);
    expect((await post(`/api/runner/link/${linkId}/pairing`, { pairing: { runnerPublicKey, proof } })).status).toBe(204);
    return linkId;
  };

  beforeAll(async () => {
    app = await boot('development', true);
    url = await app.getUrl();
  });

  afterAll(async () => {
    await post('/api/testing/scenarios/blank', {});
    await app.close();
  });

  it('gives the link code and its confirm token; confirm answers 409 testing.smoke-not-pending until the binary sent its pairing', async () => {
    const { runnerLink, sessionCookie } = await scenario();

    expect(runnerLink?.code).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]+$/);
    expect(sessionCookie).toBeTruthy();
    await expectEnvelope(await post('/api/testing/smoke/confirm', { confirmToken: runnerLink?.confirmToken }), 409, 'testing.smoke-not-pending');
  });

  it('confirms the link as the page does, the Runner then linked with its token and the page’s pairing, and starts a Session on the Projet', async () => {
    const { runnerLink, sessionCookie } = await scenario();
    const [shortId = '', secret = ''] = (runnerLink?.code ?? '').split('-');
    const linkId = await linkAndPair(shortId, unbase32(secret));

    expect((await post('/api/testing/smoke/confirm', { confirmToken: runnerLink?.confirmToken })).status).toBe(204);

    const status = zRunnerLinkStatus.parse(await (await fetch(`${url}/api/runner/link/${linkId}`)).json());
    expect(status).toMatchObject({ state: 'linked', token: expect.any(String) });
    expect(status.pairing?.runnerVaultWrap).toMatchObject({ enc: expect.any(String), ciphertext: expect.any(String), tag: expect.any(String) });

    const res = await post('/api/testing/smoke/sessions', { confirmToken: runnerLink?.confirmToken });
    expect(res.status).toBe(201);
    const session = zAgentSession.parse(await res.json());
    expect(session).toMatchObject({ engine: 'claude-code', model: 'claude-opus-5-5', branch: 'smoke/session' });
    const view = await fetch(`${url}/api/sessions/${session.id}`, { headers: { cookie: sessionCookie ?? '' } });
    expect(view.status).toBe(200);
  });

  it('answers 422 testing.smoke-proof-invalid for a Runner whose proof is not of the code’s secret', async () => {
    const { runnerLink } = await scenario();
    const [shortId = ''] = (runnerLink?.code ?? '').split('-');
    await linkAndPair(shortId, Buffer.alloc(16, 7));

    await expectEnvelope(await post('/api/testing/smoke/confirm', { confirmToken: runnerLink?.confirmToken }), 422, 'testing.smoke-proof-invalid');
  });

  it('answers 404 testing.smoke-unknown for another token, and 400 without one', async () => {
    await scenario();

    await expectEnvelope(await post('/api/testing/smoke/confirm', { confirmToken: 'autre' }), 404, 'testing.smoke-unknown');
    await expectEnvelope(await post('/api/testing/smoke/sessions', { confirmToken: 'autre' }), 404, 'testing.smoke-unknown');
    expect((await post('/api/testing/smoke/confirm', {})).status).toBe(400);
  });

  it('gives 404 on a server booted without CREWDECK_FAKES (production)', async () => {
    const prod = await boot('production', false);
    try {
      const prodUrl = await prod.getUrl();
      for (const path of ['/api/testing/smoke/confirm', '/api/testing/smoke/sessions', '/api/testing/scenarios/smoke']) {
        expect((await fetch(`${prodUrl}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"confirmToken":"x"}' })).status).toBe(404);
      }
    } finally {
      await prod.close();
    }
  });
});
