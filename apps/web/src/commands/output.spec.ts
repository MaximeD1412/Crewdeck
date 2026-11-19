import {
  type CommandOutputChunk,
  type TabCommandClientMessage,
  type TabCommandServerMessage,
  commandOutputAad,
  commandWrapAad,
} from '@crewdeck/contracts';
import { toBase64Url, utf8 } from '../keys/bytes.js';
import { INFO, aesGcmSeal, exportAesKey, generateAesKey, sealWrap } from '../keys/crypto.js';
import { memoryDeviceStore, x25519FromPrivateKey } from '../keys/testing.js';
import { type CommandSocket, createCommandOutputRelay } from './output.js';

const RUN = '019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6c01';
const OTHER_RUN = '019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6c02';

type Keys = Extract<TabCommandServerMessage, { type: 'command.keys' }>;
type Output = Extract<TabCommandServerMessage, { type: 'command.output' }>;

/** The page's socket: what the relay sent, and the server's messages handed to it. */
const fakeSocket = () => {
  const sent: TabCommandClientMessage[] = [];
  const listeners = new Set<(message: TabCommandServerMessage) => void>();
  const openListeners = new Set<() => void>();
  let connected = true;
  const socket: CommandSocket = {
    sendCommand: (message) => {
      if (!connected) return false;
      sent.push(message);
      return true;
    },
    onCommand: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    onOpen: (listener) => {
      openListeners.add(listener);
      return () => openListeners.delete(listener);
    },
  };
  return {
    socket,
    sent,
    receive: (message: TabCommandServerMessage) => {
      for (const listener of listeners) listener(message);
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

const pair = () => x25519FromPrivateKey(crypto.getRandomValues(new Uint8Array(32)));

/** An Appareil paired with a Runner, and the run's key as the Runner wraps and seals with it. */
const setUp = async ({ runnerKey = true } = {}) => {
  const device = await pair();
  const runner = await pair();
  const devices = memoryDeviceStore({
    deviceId: '019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6a10',
    privateKey: device.privateKey,
    publicKey: device.publicKey,
    ...(runnerKey ? { runnerPublicKey: runner.publicKey } : {}),
  });
  const socket = fakeSocket();
  const warn = vi.fn();
  const relay = createCommandOutputRelay({ socket: socket.socket, devices, warn });
  const runKey = await generateAesKey({ extractable: true });
  const holderId = toBase64Url(device.publicKey);

  /** The run's key wrapped for this Appareil by the Runner, under `"command:<runId>:<holderId>"`. */
  const keys = async ({ runId = RUN, aad = commandWrapAad(runId, holderId), sender = runner.privateKey } = {}): Promise<Keys> => {
    const wrap = await sealWrap(sender, device.publicKey, await exportAesKey(runKey), INFO.sessionKey, utf8(aad));
    return { type: 'command.keys', runId, wraps: [{ holderId, enc: toBase64Url(wrap.enc), wrappedKey: toBase64Url(wrap.ciphertext), tag: toBase64Url(wrap.tag) }] };
  };
  /** A chunk sealed as the Runner seals it, under `"command:<runId>:<seq>"`. */
  const chunk = async (seq: number, plain: CommandOutputChunk, aad = commandOutputAad(RUN, seq)): Promise<Output> => {
    const sealed = await aesGcmSeal(runKey, utf8(JSON.stringify(plain)), utf8(aad));
    return { type: 'command.output', runId: RUN, seq, nonce: toBase64Url(sealed.subarray(0, 12)), ciphertext: toBase64Url(sealed.subarray(12)) };
  };
  return { socket, warn, relay, keys, chunk };
};

const line = (text: string, stream: 'stdout' | 'stderr' = 'stdout'): CommandOutputChunk => ({ stream, text, at: '2026-11-17T09:00:05.000Z' });

describe('the output of a Commande’s run in the page', () => {
  it('opens the run from its first chunk, opens the Runner’s key, then shows its chunks in order, one held before the key waiting for it', async () => {
    const { socket, relay, keys, chunk, warn } = await setUp();
    const output = relay.openCommandOutput(RUN);
    const changes = vi.fn();
    output.onChange(changes);

    expect(socket.sent).toEqual([{ type: 'command.open', runId: RUN, fromSeq: 1 }]);
    socket.receive(await chunk(1, line('pnpm test\n')));
    socket.receive(await keys());
    socket.receive(await chunk(2, line('1 failed\n', 'stderr')));

    await vi.waitFor(() => expect(output.chunks()).toEqual([line('pnpm test\n'), line('1 failed\n', 'stderr')]));
    expect(changes).toHaveBeenCalledTimes(2);
    expect(relay.openCommandOutput(RUN)).toBe(output);
    expect(warn).not.toHaveBeenCalled();
  });

  it('drops, with a warning naming only its ids, a chunk sealed for another seq or run, and keys not wrapped for this run by the paired Runner', async () => {
    const { socket, relay, keys, chunk, warn } = await setUp();
    const output = relay.openCommandOutput(RUN);
    const stranger = await pair();

    socket.receive(await keys({ aad: `${RUN}:x` }));
    socket.receive(await keys({ sender: stranger.privateKey }));
    await vi.waitFor(() => expect(warn).toHaveBeenCalledTimes(2));
    socket.receive(await keys());
    socket.receive(await chunk(1, line('secret 1\n'), commandOutputAad(RUN, 2)));
    socket.receive(await chunk(1, line('secret 2\n'), commandOutputAad(OTHER_RUN, 1)));
    await vi.waitFor(() => expect(warn).toHaveBeenCalledTimes(4));

    expect(output.chunks()).toEqual([]);
    expect(warn.mock.calls.at(-1)).toEqual([expect.any(String), { runId: RUN, seq: 1 }]);
    expect(JSON.stringify(warn.mock.calls)).not.toContain('secret');
  });

  it('asks the run again from the first missing seq after a gap, once, and shows the chunks past it once it is filled', async () => {
    const { socket, relay, keys, chunk } = await setUp();
    const output = relay.openCommandOutput(RUN);
    socket.receive(await keys());
    socket.receive(await chunk(1, line('a\n')));
    socket.receive(await chunk(3, line('c\n')));
    socket.receive(await chunk(4, line('d\n')));

    await vi.waitFor(() => expect(socket.sent).toEqual([expect.objectContaining({ fromSeq: 1 }), { type: 'command.open', runId: RUN, fromSeq: 2 }]));
    expect(output.chunks()).toEqual([line('a\n')]);
    socket.receive(await chunk(2, line('b\n')));
    await vi.waitFor(() => expect(output.chunks()).toEqual([line('a\n'), line('b\n'), line('c\n'), line('d\n')]));
  });

  it('shows the server’s refusal until a chunk comes, and opens the run again from what it lacks on each socket opened again', async () => {
    const { socket, relay, keys, chunk } = await setUp();
    const output = relay.openCommandOutput(RUN);
    socket.receive({ type: 'command.error', runId: RUN, code: 'command.runner-offline' });
    await vi.waitFor(() => expect(output.error()).toBe('command.runner-offline'));

    socket.receive(await keys());
    socket.receive(await chunk(1, line('a\n')));
    await vi.waitFor(() => expect(output.error()).toBeNull());
    socket.drop();
    socket.reopen();

    expect(socket.sent.at(-1)).toEqual({ type: 'command.open', runId: RUN, fromSeq: 2 });
  });

  it('closes the run: tells the server, drops what it decrypted, and handles nothing more of it', async () => {
    const { socket, relay, keys, chunk } = await setUp();
    const output = relay.openCommandOutput(RUN);
    socket.receive(await keys());
    socket.receive(await chunk(1, line('a\n')));
    await vi.waitFor(() => expect(output.chunks()).toHaveLength(1));

    relay.closeCommandOutput(RUN);
    socket.receive(await chunk(2, line('b\n')));
    socket.reopen();

    expect(output.chunks()).toEqual([]);
    expect(socket.sent.at(-1)).toEqual({ type: 'command.close', runId: RUN });
    expect(relay.openCommandOutput(RUN)).not.toBe(output);
  });

  it('drops the keys, with a warning, on an Appareil that holds no Runner key', async () => {
    const { socket, relay, keys, chunk, warn } = await setUp({ runnerKey: false });
    const output = relay.openCommandOutput(RUN);
    socket.receive(await keys());
    socket.receive(await chunk(1, line('a\n')));

    await vi.waitFor(() => expect(warn).toHaveBeenCalledWith(expect.any(String), { runId: RUN }));
    expect(output.chunks()).toEqual([]);
  });
});
