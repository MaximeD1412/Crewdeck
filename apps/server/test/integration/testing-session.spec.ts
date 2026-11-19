import type { INestApplication } from '@nestjs/common';
import { SESSION_KEY_INFO, zAgentSession, zEngineEvent, zScenarioRun, type ScenarioRun } from '@crewdeck/contracts';
import { inject } from 'vitest';
import { createApp } from '../../src/app.js';
import { appOrigin, parseEnv } from '../../src/config/env.js';
import { newId } from '../../src/ids.js';
import { heldReply } from '../../src/testing/fake-runner.js';
import { SESSION_ID, STOPPED_AT } from '../../src/testing/scenarios/session.js';
import { openFrame, openWrap, sealFrame } from '../../src/testing/vault.js';
import { connect, type WsClient } from '../fakes/ws-client.js';

const databaseUrl = inject('databaseUrl');
const env = parseEnv({ CREWDECK_ENV: 'test', NODE_ENV: 'development', DATABASE_URL: databaseUrl, CREWDECK_FAKES: '1' });

const bytes = (text: string): Buffer => Buffer.from(text, 'base64url');

describe('the scenarios of a Session (SESSION-2) against PostgreSQL', () => {
  let app: INestApplication;
  let url: string;
  const tabs: WsClient[] = [];

  beforeAll(async () => {
    app = await createApp(env, { logs: false });
    await app.listen(0, '127.0.0.1');
    url = await app.getUrl();
  });

  afterAll(async () => {
    await run('blank');
    await app.close();
  });

  afterEach(async () => {
    await Promise.all(tabs.splice(0).map((tab) => tab.close()));
  });

  const run = async (name: string): Promise<ScenarioRun> =>
    zScenarioRun.parse(await (await fetch(`${url}/api/testing/scenarios/${name}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).json());

  const session = async (cookie: string) => zAgentSession.parse(await (await fetch(`${url}/api/sessions/${SESSION_ID}`, { headers: { cookie } })).json());

  const tab = async (cookie: string): Promise<WsClient> => {
    const client = await connect(url, { cookie, origin: appOrigin(env) });
    tabs.push(client);
    client.send({ type: 'ping' });
    await client.next('pong');
    return client;
  };

  it('relays the mockup’s conversation sealed for the scenario’s Appareil, and answers its message live, once the fake Runner started the Session', async () => {
    const { path, sessionCookie, device } = await run('session');
    const cookie = sessionCookie ?? '';
    expect(path).toBe(`/a-toi?session=${SESSION_ID}`);
    await vi.waitFor(async () => expect((await session(cookie)).state).toBe('active'));
    if (!device?.runnerPublicKey) throw new Error('the scenario seeds an Appareil paired with the Runner');

    const opener = await tab(cookie);
    opener.send({ type: 'session.open', sessionId: SESSION_ID, fromSeq: 1 });
    const { wraps } = await opener.next('session.keys');
    const holderId = device.publicKey;
    const wrap = wraps.find((candidate) => candidate.holderId === holderId);
    if (!wrap) throw new Error('no wrap for the scenario’s Appareil');
    const key = openWrap(
      bytes(device.privateKey),
      bytes(device.runnerPublicKey),
      { enc: bytes(wrap.enc), ciphertext: bytes(wrap.wrappedKey), tag: bytes(wrap.tag) },
      SESSION_KEY_INFO,
      `${SESSION_ID}:${holderId}`,
    );
    const events = [];
    for (let seq = 1; seq <= 11; seq += 1) {
      const frame = await opener.next('relay');
      expect(frame.seq).toBe(seq);
      events.push(zEngineEvent.parse(JSON.parse(openFrame(key, frame, `${SESSION_ID}:${seq}`).toString('utf8'))));
    }
    expect(events.map((event) => event.kind)).toEqual([
      'tool-call',
      'tool-result',
      'tool-call',
      'tool-result',
      'message',
      'message',
      'tool-call',
      'tool-result',
      'message',
      'tool-call',
      'tool-result',
    ]);
    expect(events[5]).toMatchObject({ kind: 'message', final: true, text: expect.stringContaining('L’Idée demande un agenda que plusieurs personnes partagent.') });

    const inputId = newId();
    const text = 'Pense aux événements récurrents.';
    opener.send({ type: 'session.input', sessionId: SESSION_ID, inputId, ...sealFrame(key, JSON.stringify({ kind: 'message', text }), `${SESSION_ID}:input:${inputId}`) });
    const live = await opener.next('relay');
    expect(live.seq).toBe(12);
    expect(JSON.parse(openFrame(key, live, `${SESSION_ID}:12`).toString('utf8'))).toMatchObject({ kind: 'message', from: 'agent', text: heldReply(text), final: true, seq: 12 });
  });

  it('seeds the Session stopped by the Pilote at 15:12, its conversation still relayed', async () => {
    const { sessionCookie } = await run('session-arretee');
    const cookie = sessionCookie ?? '';
    expect(await session(cookie)).toMatchObject({ state: 'stopped', endedAt: STOPPED_AT.toISOString(), title: 'Concevoir · Agenda partagé' });

    const opener = await tab(cookie);
    opener.send({ type: 'session.open', sessionId: SESSION_ID, fromSeq: 10 });
    await opener.next('session.keys');
    expect((await opener.next('relay')).seq).toBe(10);
    expect((await opener.next('relay')).seq).toBe(11);
  });

  it('seeds the Session interrupted with the Runner offline: the open is answered session.runner-offline', async () => {
    const { sessionCookie } = await run('session-runner-hors-ligne');
    const cookie = sessionCookie ?? '';
    expect(await session(cookie)).toMatchObject({ state: 'interrupted', interruptedReason: 'runner-offline' });

    const opener = await tab(cookie);
    opener.send({ type: 'session.open', sessionId: SESSION_ID, fromSeq: 1 });
    expect(await opener.next('session.error')).toEqual({ type: 'session.error', sessionId: SESSION_ID, code: 'session.runner-offline' });
  });
});
