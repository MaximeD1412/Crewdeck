import {
  type CommandOutputChunk,
  type CommandRelayError,
  type TabCommandClientMessage,
  type TabCommandServerMessage,
  commandOutputAad,
  commandWrapAad,
  zCommandOutputChunk,
} from '@crewdeck/contracts';
import { concat, fromBase64Url, toBase64Url, utf8 } from '../keys/bytes.js';
import { INFO, aesGcmOpen, importAesKey, openWrap } from '../keys/crypto.js';
import type { DeviceStore } from '../keys/device-store.js';
import { type SessionBuffer, createSessionBuffer } from '../sessions/session-buffer.js';

/**
 * The output of a Commande's run in the page (RUNNER-18,
 * `docs/security/e2e.md` « Commandes »), the Session's relay to the letter:
 * the tab follows a run through the server, which only forwards what the
 * Runner sealed.
 *
 * - `command.keys`: the run's key, wrapped by the Runner for each Appareil
 *   under `"command:<runId>:<holderId>"`; the tab opens its own with the
 *   Runner's public key it authenticated at pairing, and keeps the key in
 *   memory as a non-extractable `CryptoKey`;
 * - `command.output`: a chunk sealed under `"command:<runId>:<seq>"`, opened,
 *   checked against its schema, and kept in order. One that does not open is
 *   dropped with a console warning naming its ids, never shown; one before
 *   the key waits for it;
 * - a gap in `seq` opens the run again from the first missing one, once per
 *   missing `seq`; a socket open again (a reconnection) too.
 *
 * Nothing it decrypts leaves memory: no IndexedDB, no localStorage, no store
 * event; `closeCommandOutput` drops it.
 */

/** The page's socket, as the relay uses it (`store/connection.ts`). */
export interface CommandSocket {
  /** Sends on the open socket; false when there is none. */
  sendCommand(message: TabCommandClientMessage): boolean;
  onCommand(listener: (message: TabCommandServerMessage) => void): () => void;
  /** Each time a socket opens, the first one and each reconnection. */
  onOpen(listener: () => void): () => void;
}

/** One run the tab follows. */
export interface CommandOutput {
  readonly runId: string;
  /** Its decrypted chunks, ordered by `seq`, up to the first missing one. */
  chunks(): readonly CommandOutputChunk[];
  /** The server's last refusal of its open, until a chunk comes. */
  error(): CommandRelayError | null;
  /** Called after each change of `chunks` or `error`. */
  onChange(listener: () => void): () => void;
}

export interface CommandOutputRelay {
  /** Follows the run from its first chunk; the same subscription while it is open. */
  openCommandOutput(runId: string): CommandOutput;
  /** Stops following the run and drops what was decrypted. */
  closeCommandOutput(runId: string): void;
}

export interface CommandOutputRelayOptions {
  readonly socket: CommandSocket;
  readonly devices: Pick<DeviceStore, 'getDevice'>;
  /** `console.warn` by default: a frame dropped, with its ids only. */
  readonly warn?: (message: string, detail: { runId: string; seq?: number }) => void;
}

/** The most chunks held while the key has not come; the rest come again through a gap. */
const PENDING_MAX = 1000;

type Frame = Extract<TabCommandServerMessage, { type: 'command.output' }>;
type Keys = Extract<TabCommandServerMessage, { type: 'command.keys' }>;
type Held = { readonly seq: number; readonly chunk: CommandOutputChunk };

interface Followed {
  readonly output: CommandOutput;
  readonly buffer: SessionBuffer<Held>;
  readonly listeners: Set<() => void>;
  shown: readonly CommandOutputChunk[];
  key: CryptoKey | null;
  pending: Frame[];
  /** The last `fromSeq` the tab asked: a gap at it is the replay on its way. */
  asked: number;
  error: CommandRelayError | null;
  /** The run's messages, handled one after the other. */
  chain: Promise<void>;
  closed: boolean;
}

export const createCommandOutputRelay = ({
  socket,
  devices,
  warn = (message, detail) => console.warn(message, detail),
}: CommandOutputRelayOptions): CommandOutputRelay => {
  const followed = new Map<string, Followed>();

  const changed = (run: Followed) => {
    for (const listener of run.listeners) listener();
  };

  const open = (runId: string, run: Followed) => {
    run.asked = run.buffer.missing();
    socket.sendCommand({ type: 'command.open', runId, fromSeq: run.asked });
  };

  const installKey = async (runId: string, run: Followed, { wraps }: Keys) => {
    const device = await devices.getDevice();
    if (run.closed) return;
    if (!device?.runnerPublicKey) return warn('command output: no Runner key on this Appareil, keys dropped', { runId });
    const holderId = toBase64Url(device.publicKey);
    const wrap = wraps.find((candidate) => candidate.holderId === holderId);
    if (!wrap) return warn('command output: no wrap for this Appareil, keys dropped', { runId });
    let raw: Uint8Array;
    try {
      raw = await openWrap(
        device.privateKey,
        device.runnerPublicKey,
        { enc: fromBase64Url(wrap.enc), ciphertext: fromBase64Url(wrap.wrappedKey), tag: fromBase64Url(wrap.tag) },
        INFO.sessionKey,
        utf8(commandWrapAad(runId, holderId)),
      );
    } catch {
      return warn('command output: the keys do not open, dropped', { runId });
    }
    let key: CryptoKey;
    try {
      if (run.closed) return;
      key = await importAesKey(raw);
    } finally {
      raw.fill(0);
    }
    // Closed while the key was opened: it stays out of the run.
    if (run.closed) return;
    run.key = key;
    for (const frame of run.pending.splice(0)) await take(runId, run, frame);
  };

  /** The frame's chunk, or null when it does not open under its own `seq` or is outside the schema. */
  const openFrame = async (key: CryptoKey, runId: string, { seq, nonce, ciphertext }: Frame): Promise<CommandOutputChunk | null> => {
    try {
      const plain = await aesGcmOpen(key, concat(fromBase64Url(nonce), fromBase64Url(ciphertext)), utf8(commandOutputAad(runId, seq)));
      return zCommandOutputChunk.safeParse(JSON.parse(new TextDecoder().decode(plain))).data ?? null;
    } catch {
      return null;
    }
  };

  const take = async (runId: string, run: Followed, frame: Frame) => {
    if (!run.key) {
      if (run.pending.length < PENDING_MAX) run.pending.push(frame);
      return;
    }
    const chunk = await openFrame(run.key, runId, frame);
    // Closed while the frame was opened: nothing of it is shown nor kept.
    if (run.closed) return;
    if (!chunk) return warn('command output: a chunk did not open, dropped', { runId, seq: frame.seq });
    const added = run.buffer.add({ seq: frame.seq, chunk });
    if (added === 'gap' && run.buffer.missing() !== run.asked) open(runId, run);
    if (added === 'added') run.shown = run.buffer.events().map((held) => held.chunk);
    if (added === 'added' || run.error) {
      run.error = null;
      changed(run);
    }
  };

  const handle = (message: TabCommandServerMessage) => {
    const run = followed.get(message.runId);
    if (!run) return;
    const step = async () => {
      if (run.closed) return;
      switch (message.type) {
        case 'command.keys':
          return installKey(message.runId, run, message);
        case 'command.output':
          return take(message.runId, run, message);
        case 'command.error':
          run.error = message.code;
          return changed(run);
      }
    };
    run.chain = run.chain.then(step).catch(() => warn('command output: a frame could not be handled', { runId: message.runId }));
  };

  socket.onCommand(handle);
  socket.onOpen(() => {
    for (const [runId, run] of followed) open(runId, run);
  });

  return {
    openCommandOutput(runId) {
      const known = followed.get(runId);
      if (known) return known.output;
      const listeners = new Set<() => void>();
      const run: Followed = {
        buffer: createSessionBuffer<Held>(),
        listeners,
        shown: [],
        key: null,
        pending: [],
        asked: 1,
        error: null,
        chain: Promise.resolve(),
        closed: false,
        output: {
          runId,
          chunks: () => run.shown,
          error: () => run.error,
          onChange(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
          },
        },
      };
      followed.set(runId, run);
      open(runId, run);
      return run.output;
    },

    closeCommandOutput(runId) {
      const run = followed.get(runId);
      if (!run) return;
      followed.delete(runId);
      run.closed = true;
      run.key = null;
      run.pending = [];
      run.shown = [];
      run.buffer.clear();
      run.listeners.clear();
      socket.sendCommand({ type: 'command.close', runId });
    },
  };
};
