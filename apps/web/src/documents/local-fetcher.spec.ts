import { type ArtifactTicket, type TabArtifactClientMessage, type TabArtifactServerMessage, artifactAad, artifactWrapAad } from '@crewdeck/contracts';
import { server } from 'vitest/browser';
import { type Bytes, fromBase64Url, toBase64Url, utf8 } from '../keys/bytes.js';
import { INFO, aesGcmSeal, exportAesKey, exportPublicKey, generateAesKey, generateKeyPair, sealWrap } from '../keys/crypto.js';
import { memoryDeviceStore, x25519FromPrivateKey } from '../keys/testing.js';
import { ArtifactOpenError, type ArtifactSocket, createLocalFetcher } from './local-fetcher.js';
import { ArtifactUnavailable, createDocumentReader } from './reader.js';

// The answer the Runner recorded (apps/runner/internal/artifact/artifact_test.go
// writes it with -update), read from the project's root (apps/web).
interface ArtifactVector {
  runnerPublicKey: string;
  devicePrivateKey: string;
  devicePublicKey: string;
  frame: Extract<TabArtifactServerMessage, { type: 'artifact.content' }>;
  plaintext: ArtifactTicket;
}

const vector = async (): Promise<ArtifactVector> =>
  JSON.parse(await server.commands.readFile('../../packages/contracts/fixtures/crypto/artifact.json')) as ArtifactVector;

const PROJECT = '019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6d21';

/** The page's socket: what the fetcher sent, the server's answers handed to it. */
const fakeSocket = ({ open = true } = {}) => {
  const sent: TabArtifactClientMessage[] = [];
  const listeners = new Set<(message: TabArtifactServerMessage) => void>();
  const socket: ArtifactSocket = {
    sendArtifact: (message) => {
      if (!open) return false;
      sent.push(message);
      return true;
    },
    onArtifact: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return {
    socket,
    sent,
    listening: () => listeners.size,
    receive: (message: TabArtifactServerMessage) => {
      for (const listener of [...listeners]) listener(message);
    },
  };
};

const setUp = async ({
  runnerKey = true,
  runnerPublicKey,
  open = true,
  timeoutMs,
}: { runnerKey?: boolean; runnerPublicKey?: Bytes; open?: boolean; timeoutMs?: number } = {}) => {
  const v = await vector();
  const device = await x25519FromPrivateKey(fromBase64Url(v.devicePrivateKey));
  expect(toBase64Url(device.publicKey)).toBe(v.devicePublicKey);
  const devices = memoryDeviceStore({
    deviceId: '019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6a10',
    privateKey: device.privateKey,
    publicKey: device.publicKey,
    ...(runnerKey ? { runnerPublicKey: runnerPublicKey ?? fromBase64Url(v.runnerPublicKey) } : {}),
  });
  const socket = fakeSocket({ open });
  const fetcher = createLocalFetcher({ socket: socket.socket, devices, newId: () => v.frame.requestId, ...(timeoutMs ? { timeoutMs } : {}) });
  return { v, socket, fetcher };
};

/** Lets the fetcher read its Appareil and send its read. */
const sent = (socket: ReturnType<typeof fakeSocket>) => vi.waitFor(() => expect(socket.sent).toHaveLength(1));

describe('the Local fetcher', () => {
  it('asks the Runner for Ticket 12 for this Appareil, and opens its recorded answer as the Runner sealed it', async () => {
    const { v, socket, fetcher } = await setUp();
    const ticket = fetcher.fetch(PROJECT, 'ticket', { number: 12 });
    await sent(socket);

    expect(socket.sent).toEqual([{ type: 'artifact.read', requestId: v.frame.requestId, projectId: PROJECT, holderId: v.devicePublicKey, kind: 'ticket', ref: { number: 12 } }]);
    socket.receive(v.frame);
    expect(await ticket).toEqual(v.plaintext);
    expect(socket.listening()).toBe(0);
  });

  it('answers ready through the reader, from the relay', async () => {
    const { v, socket, fetcher } = await setUp();
    const reader = createDocumentReader({ fetchers: { github: fetcher, local: fetcher } });
    const result = reader.read({ projectId: PROJECT, source: 'local', kind: 'ticket', ref: { number: 12 } });
    await sent(socket);
    socket.receive(v.frame);

    expect(await result).toEqual({ state: 'ready', value: v.plaintext });
  });

  it('rejects with the code of the server’s or the Runner’s artifact.error, and ignores another request’s answer', async () => {
    const { v, socket, fetcher } = await setUp();
    const ticket = fetcher.fetch(PROJECT, 'ticket', { number: 12 });
    await sent(socket);
    socket.receive({ type: 'artifact.error', requestId: '019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6d19', code: 'artifact.timeout' });
    socket.receive({ type: 'artifact.error', requestId: v.frame.requestId, code: 'artifact.too-large' });

    await expect(ticket).rejects.toEqual(new ArtifactUnavailable('too-large'));
    expect(socket.listening()).toBe(0);
  });

  it('is runner-offline without an open socket, and untrusted-device on an Appareil the Runner never authenticated, without asking', async () => {
    const closed = await setUp({ open: false });
    await expect(closed.fetcher.fetch(PROJECT, 'ticket', { number: 12 })).rejects.toEqual(new ArtifactUnavailable('runner-offline'));
    expect(closed.socket.listening()).toBe(0);

    const unpaired = await setUp({ runnerKey: false });
    await expect(unpaired.fetcher.fetch(PROJECT, 'ticket', { number: 12 })).rejects.toEqual(new ArtifactUnavailable('untrusted-device'));
    expect(unpaired.socket.sent).toEqual([]);
  });

  it('opens a Local Ticket whose jalon milestones.yml does not hold, its milestone without number', async () => {
    const runner = await generateKeyPair();
    const { v, socket, fetcher } = await setUp({ runnerPublicKey: await exportPublicKey(runner.publicKey) });
    const plaintext: ArtifactTicket = { ...v.plaintext, milestone: { number: null, title: 'M1', description: '', dueOn: null } };
    // Sealed as the Runner seals (apps/runner/internal/artifact/seal.go).
    const key = await generateAesKey({ extractable: true });
    const wrap = await sealWrap(runner.privateKey, fromBase64Url(v.devicePublicKey), await exportAesKey(key), INFO.sessionKey, utf8(artifactWrapAad(v.frame.requestId, v.devicePublicKey)));
    const sealed = await aesGcmSeal(key, utf8(JSON.stringify(plaintext)), utf8(artifactAad(v.frame.requestId)));

    const ticket = fetcher.fetch(PROJECT, 'ticket', { number: 12 });
    await sent(socket);
    socket.receive({
      ...v.frame,
      wrap: { holderId: v.devicePublicKey, enc: toBase64Url(wrap.enc), wrappedKey: toBase64Url(wrap.ciphertext), tag: toBase64Url(wrap.tag) },
      nonce: toBase64Url(sealed.subarray(0, 12)),
      ciphertext: toBase64Url(sealed.subarray(12)),
    });
    expect(await ticket).toEqual(plaintext);
  });

  it('is timeout when no answer comes', async () => {
    const { socket, fetcher } = await setUp({ timeoutMs: 20 });
    await expect(fetcher.fetch(PROJECT, 'ticket', { number: 12 })).rejects.toEqual(new ArtifactUnavailable('timeout'));
    expect(socket.listening()).toBe(0);
  });

  it('refuses an answer altered on the way, sealed for another Appareil, or read as another kind', async () => {
    const { v, socket, fetcher } = await setUp();
    const flipped = fromBase64Url(v.frame.ciphertext);
    flipped[0] = (flipped[0] ?? 0) ^ 1;
    const answers = [
      { ...v.frame, ciphertext: toBase64Url(flipped) },
      { ...v.frame, wrap: { ...v.frame.wrap, holderId: toBase64Url(new Uint8Array(32)) } },
    ];
    for (const answer of answers) {
      const ticket = fetcher.fetch(PROJECT, 'ticket', { number: 12 });
      await vi.waitFor(() => expect(socket.listening()).toBe(1));
      socket.receive(answer);
      await expect(ticket).rejects.toBeInstanceOf(ArtifactOpenError);
    }

    const asFile = fetcher.fetch(PROJECT, 'file', { path: 'docs/prd.md' });
    await vi.waitFor(() => expect(socket.listening()).toBe(1));
    socket.receive(v.frame);
    await expect(asFile).rejects.toBeInstanceOf(ArtifactOpenError);
  });
});
