import { type EngineEvent, INPUT_CIPHERTEXT_MAX, type TabRelayClientMessage, type TabRelayServerMessage } from '@crewdeck/contracts';
import { server } from 'vitest/browser';
import { concat, fromBase64Url, toBase64Url, utf8 } from '../keys/bytes.js';
import { aesGcmOpen, aesGcmSeal, importAesKey } from '../keys/crypto.js';
import { memoryDeviceStore, withDeterministicRandom, x25519FromPrivateKey } from '../keys/testing.js';
import { type RelaySocket, SessionInputError, createSessionRelay } from './relay.js';

// The vectors shared with the Runner (apps/runner/internal/keys/generate_test.go
// writes relay.json; apps/runner/internal/session/relay_test.go opens
// web-relay.json), read from the project's root (apps/web).
const fixtures = '../../packages/contracts/fixtures/crypto/';

type Keys = Extract<TabRelayServerMessage, { type: 'session.keys' }>;
type Frame = Extract<TabRelayServerMessage, { type: 'relay' }>;
type Input = Extract<TabRelayClientMessage, { type: 'session.input' }>;

interface RelayVectors {
  seed: string;
  sessionId: string;
  runnerPublicKey: string;
  devicePrivateKey: string;
  devicePublicKey: string;
  sessionKey: string;
  keys: Keys;
  frames: { event: EngineEvent; frame: Frame }[];
  input: { payload: { kind: 'message'; text: string }; frame: Input };
}

const vectors = async (): Promise<RelayVectors> =>
  JSON.parse(await server.commands.readFile(fixtures + 'relay.json')) as RelayVectors;

/** The page's socket: what the relay sent, and the server's messages handed to it. */
const fakeSocket = () => {
  const sent: TabRelayClientMessage[] = [];
  const relayListeners = new Set<(message: TabRelayServerMessage) => void>();
  const openListeners = new Set<() => void>();
  let connected = true;
  const socket: RelaySocket = {
    sendRelay: (message) => {
      if (!connected) return false;
      sent.push(message);
      return true;
    },
    onRelay: (listener) => {
      relayListeners.add(listener);
      return () => relayListeners.delete(listener);
    },
    onOpen: (listener) => {
      openListeners.add(listener);
      return () => openListeners.delete(listener);
    },
  };
  return {
    socket,
    sent,
    receive: (message: TabRelayServerMessage) => {
      for (const listener of relayListeners) listener(message);
    },
    reopen: () => {
      connected = true;
      for (const listener of openListeners) listener();
    },
    drop: () => {
      connected = false;
    },
  };
};

const setUp = async ({ runnerKey = true } = {}) => {
  const v = await vectors();
  const device = await x25519FromPrivateKey(fromBase64Url(v.devicePrivateKey));
  expect(toBase64Url(device.publicKey)).toBe(v.devicePublicKey);
  const devices = memoryDeviceStore({
    deviceId: '019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6a10',
    privateKey: device.privateKey,
    publicKey: device.publicKey,
    ...(runnerKey ? { runnerPublicKey: fromBase64Url(v.runnerPublicKey) } : {}),
  });
  const socket = fakeSocket();
  const warn = vi.fn();
  const relay = createSessionRelay({ socket: socket.socket, devices, warn });
  const sessionKey = await importAesKey(fromBase64Url(v.sessionKey));
  /** An event sealed as the Runner seals it, under `"<sessionId>:<seq>"`. */
  const seal = async (event: EngineEvent, aad = `${v.sessionId}:${event.seq}`): Promise<Frame> => {
    const sealed = await aesGcmSeal(sessionKey, utf8(JSON.stringify(event)), utf8(aad));
    return {
      type: 'relay',
      sessionId: v.sessionId,
      seq: event.seq,
      nonce: toBase64Url(sealed.subarray(0, 12)),
      ciphertext: toBase64Url(sealed.subarray(12)),
    };
  };
  return { v, socket, warn, relay, sessionKey, seal };
};

const message = (seq: number, text: string): EngineEvent => ({
  kind: 'message',
  seq,
  at: '2026-11-16T09:00:05.000Z',
  from: 'agent',
  text,
  final: false,
});

describe('the relay of a Session in the page', () => {
  it('opens the Session from its first event, opens the Runner’s keys and frames, then shows the live ones in order', async () => {
    const { v, socket, relay, seal, warn } = await setUp();
    const session = relay.openSession(v.sessionId);
    const changes = vi.fn();
    session.onChange(changes);

    expect(socket.sent).toEqual([{ type: 'session.open', sessionId: v.sessionId, fromSeq: 1 }]);
    socket.receive(v.keys);
    for (const { frame } of v.frames) socket.receive(frame);
    const live = message(3, 'Les tests passent.');
    socket.receive(await seal(live));

    await vi.waitFor(() => expect(session.events()).toEqual([...v.frames.map(({ event }) => event), live]));
    expect(changes).toHaveBeenCalledTimes(3);
    expect(warn).not.toHaveBeenCalled();
    // The same subscription while the Session is open: no second open.
    expect(relay.openSession(v.sessionId)).toBe(session);
    expect(socket.sent).toHaveLength(1);
  });

  it('holds the frames that come before the keys, and shows them once the keys are opened', async () => {
    const { v, socket, relay } = await setUp();
    const session = relay.openSession(v.sessionId);

    for (const { frame } of v.frames) socket.receive(frame);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(session.events()).toEqual([]);
    socket.receive(v.keys);

    await vi.waitFor(() => expect(session.events()).toEqual(v.frames.map(({ event }) => event)));
  });

  it('drops with a warning, never shows, a frame whose additional data is another seq’s or another Session’s', async () => {
    const { v, socket, relay, seal, warn } = await setUp();
    const session = relay.openSession(v.sessionId);
    socket.receive(v.keys);
    const [first, second] = v.frames as [RelayVectors['frames'][0], RelayVectors['frames'][0]];

    // The frame of seq 2 relabelled seq 1: its additional data is "<sessionId>:2".
    socket.receive({ ...second.frame, seq: 1 });
    // Sealed for another Session, relayed as this one's.
    socket.receive(await seal(first.event, `019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6b01:1`));
    // Sealed under its own seq, but holding another one's event.
    socket.receive(await seal({ ...first.event, seq: 2 }, `${v.sessionId}:1`).then((frame) => ({ ...frame, seq: 1 })));
    await vi.waitFor(() => expect(warn).toHaveBeenCalledTimes(3));

    expect(warn).toHaveBeenCalledWith('session relay: a frame did not open, dropped', { sessionId: v.sessionId, seq: 1 });
    expect(JSON.stringify(warn.mock.calls)).not.toContain(first.event.kind === 'message' ? first.event.text : '');
    expect(session.events()).toEqual([]);
    socket.receive(first.frame);
    await vi.waitFor(() => expect(session.events()).toEqual([first.event]));
  });

  it('drops with a warning keys that do not open under the Runner’s key the Appareil authenticated, and shows none of the frames', async () => {
    const { v, socket, relay, warn } = await setUp();
    const session = relay.openSession(v.sessionId);
    const [wrap] = v.keys.wraps as [Keys['wraps'][0]];
    const tampered = fromBase64Url(wrap.wrappedKey);
    tampered[0] = (tampered[0] ?? 0) ^ 0x01;

    socket.receive({ ...v.keys, wraps: [{ ...wrap, wrappedKey: toBase64Url(tampered) }] });
    socket.receive({ ...v.keys, wraps: [{ ...wrap, holderId: toBase64Url(new Uint8Array(32)) }] });
    for (const { frame } of v.frames) socket.receive(frame);

    await vi.waitFor(() => expect(warn).toHaveBeenCalledTimes(2));
    expect(warn.mock.calls.map(([text]) => text)).toEqual([
      'session relay: the keys do not open, dropped',
      'session relay: no wrap for this Appareil, keys dropped',
    ]);
    expect(session.events()).toEqual([]);
  });

  it('drops the keys with a warning on an Appareil that holds no Runner key: none sent by the server is used', async () => {
    const { v, socket, relay, warn } = await setUp({ runnerKey: false });
    const session = relay.openSession(v.sessionId);

    socket.receive(v.keys);
    for (const { frame } of v.frames) socket.receive(frame);

    await vi.waitFor(() =>
      expect(warn).toHaveBeenCalledWith('session relay: no Runner key on this Appareil, keys dropped', { sessionId: v.sessionId }),
    );
    expect(session.events()).toEqual([]);
  });

  it('opens the Session again from the first missing seq on a gap, once, and drops an event shown already', async () => {
    const { v, socket, relay, seal } = await setUp();
    const session = relay.openSession(v.sessionId);
    socket.receive(v.keys);
    const [first, second] = v.frames as [RelayVectors['frames'][0], RelayVectors['frames'][0]];

    socket.receive(first.frame);
    socket.receive(await seal(message(3, 'trois')));
    socket.receive(await seal(message(4, 'quatre')));
    await vi.waitFor(() => expect(socket.sent).toHaveLength(2));
    expect(socket.sent[1]).toEqual({ type: 'session.open', sessionId: v.sessionId, fromSeq: 2 });
    expect(session.events()).toEqual([first.event]);

    socket.receive(second.frame);
    socket.receive(first.frame);
    await vi.waitFor(() => expect(session.events().map((event) => event.seq)).toEqual([1, 2, 3, 4]));
    expect(socket.sent).toHaveLength(2);
  });

  it('opens each followed Session again from its first missing seq when the socket opens again', async () => {
    const { v, socket, relay } = await setUp();
    relay.openSession(v.sessionId);
    socket.receive(v.keys);
    for (const { frame } of v.frames) socket.receive(frame);
    await vi.waitFor(() => expect(relay.openSession(v.sessionId).events()).toHaveLength(2));

    socket.drop();
    socket.reopen();

    expect(socket.sent.at(-1)).toEqual({ type: 'session.open', sessionId: v.sessionId, fromSeq: 3 });
  });

  it('keeps the server’s refusal until a frame comes', async () => {
    const { v, socket, relay } = await setUp();
    const session = relay.openSession(v.sessionId);

    socket.receive({ type: 'session.error', sessionId: v.sessionId, code: 'session.runner-offline' });
    await vi.waitFor(() => expect(session.error()).toBe('session.runner-offline'));
    socket.receive(v.keys);
    socket.receive((v.frames[0] as RelayVectors['frames'][0]).frame);

    await vi.waitFor(() => expect(session.error()).toBeNull());
  });

  it('seals the Pilote’s input under "<sessionId>:input:<inputId>", the same inputId when sent again', async () => {
    const { v, socket, relay, sessionKey } = await setUp();
    relay.openSession(v.sessionId);
    socket.receive(v.keys);

    const inputId = await relay.sendInput(v.sessionId, v.input.payload);
    await relay.sendInput(v.sessionId, v.input.payload, inputId);

    const inputs = socket.sent.filter((sent): sent is Input => sent.type === 'session.input');
    expect(inputs.map((input) => input.inputId)).toEqual([inputId, inputId]);
    expect(inputId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    for (const input of inputs) {
      const sealed = concat(fromBase64Url(input.nonce), fromBase64Url(input.ciphertext));
      const plain = await aesGcmOpen(sessionKey, sealed, utf8(`${v.sessionId}:input:${inputId}`));
      expect(JSON.parse(new TextDecoder().decode(plain))).toEqual(v.input.payload);
      await expect(aesGcmOpen(sessionKey, sealed, utf8(`${v.sessionId}:input:${v.input.frame.inputId}`))).rejects.toThrow();
    }
  });

  it('sends no input before the Session’s keys, nor without a socket', async () => {
    const { v, socket, relay } = await setUp();
    relay.openSession(v.sessionId);

    await expect(relay.sendInput(v.sessionId, v.input.payload)).rejects.toEqual(new SessionInputError('no-key'));
    await expect(relay.sendInput('019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6b01', v.input.payload)).rejects.toEqual(new SessionInputError('no-key'));
    socket.receive(v.keys);
    socket.drop();
    await expect(relay.sendInput(v.sessionId, v.input.payload)).rejects.toEqual(new SessionInputError('not-connected'));
    expect(socket.sent.filter((sent) => sent.type === 'session.input')).toEqual([]);
  });

  it('sends an input up to the frame’s limit once sealed, and refuses one beyond it without sending it', async () => {
    const { v, socket, relay } = await setUp();
    relay.openSession(v.sessionId);
    socket.receive(v.keys);
    // '{"kind":"message","text":""}' is 28 bytes, "漢" 3: 28 + 87 366 × 3 + 2 + the 16 bytes of the tag is the limit.
    const atTheLimit = { kind: 'message' as const, text: `${'漢'.repeat(87_366)}ok` };
    const beyond = { kind: 'message' as const, text: `${'漢'.repeat(87_366)}oui` };

    await relay.sendInput(v.sessionId, atTheLimit);
    await expect(relay.sendInput(v.sessionId, beyond)).rejects.toEqual(new SessionInputError('too-large'));

    const inputs = socket.sent.filter((sent) => sent.type === 'session.input');
    expect(inputs).toHaveLength(1);
    expect(fromBase64Url((inputs[0] as Extract<TabRelayClientMessage, { type: 'session.input' }>).ciphertext)).toHaveLength(INPUT_CIPHERTEXT_MAX);
  });

  it('shows nothing of a frame whose decryption ends after the Session was closed', async () => {
    const { v, socket, relay } = await setUp();
    const session = relay.openSession(v.sessionId);
    socket.receive(v.keys);
    // Its key opened: an input goes.
    await relay.sendInput(v.sessionId, v.input.payload);
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const decrypt = crypto.subtle.decrypt.bind(crypto.subtle);
    const spy = vi.spyOn(crypto.subtle, 'decrypt').mockImplementation(async (...args) => {
      await gate;
      return decrypt(...args);
    });

    try {
      socket.receive((v.frames[0] as RelayVectors['frames'][0]).frame);
      await vi.waitFor(() => expect(spy).toHaveBeenCalled());
      relay.closeSession(v.sessionId);
      release();
      await new Promise((resolve) => setTimeout(resolve, 20));
    } finally {
      spy.mockRestore();
    }

    expect(session.events()).toEqual([]);
  });

  it('stops following a closed Session, drops what it decrypted, and keeps none of it in the browser’s storage', async () => {
    const { v, socket, relay, seal } = await setUp();
    const session = relay.openSession(v.sessionId);
    socket.receive(v.keys);
    for (const { frame } of v.frames) socket.receive(frame);
    await vi.waitFor(() => expect(session.events()).toHaveLength(2));
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);

    relay.closeSession(v.sessionId);
    socket.receive(await seal(message(3, 'après')));
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(socket.sent.at(-1)).toEqual({ type: 'session.close', sessionId: v.sessionId });
    expect(session.events()).toEqual([]);
    await expect(relay.sendInput(v.sessionId, v.input.payload)).rejects.toEqual(new SessionInputError('no-key'));
  });

  it('writes web-relay.json: an input the browser sealed, for the Runner to hand to its Moteur', async () => {
    const { v, socket, relay } = await setUp();
    relay.openSession(v.sessionId);
    socket.receive(v.keys);
    const seed = utf8('crewdeck-web/relay-input');
    const inputId = '019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6aa3';
    const payload = { kind: 'message' as const, text: 'Écrit dans le navigateur, lu par le Moteur.' };

    await withDeterministicRandom(seed, () => relay.sendInput(v.sessionId, payload, inputId));

    const file = {
      description:
        'Written by the browser (apps/web/src/sessions/relay.spec.ts, Chromium WebCrypto): an input sealed under the Session key of relay.json, opened by the Runner (apps/runner/internal/session/relay_test.go).',
      seed: toBase64Url(seed),
      sessionId: v.sessionId,
      sessionKey: v.sessionKey,
      payload,
      frame: socket.sent.at(-1),
    };
    await server.commands.writeFile(fixtures + 'web-relay.json', JSON.stringify(file, null, 2) + '\n');
    expect(JSON.parse(await server.commands.readFile(fixtures + 'web-relay.json'))).toEqual(file);
  });
});
