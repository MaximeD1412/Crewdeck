import {
  type EngineEvent,
  INPUT_CIPHERTEXT_MAX,
  type SessionInputPayload,
  type SessionRelayError,
  type TabRelayClientMessage,
  type TabRelayServerMessage,
  zEngineEvent,
  zSessionInputPayload,
} from '@crewdeck/contracts';
import { concat, fromBase64Url, toBase64Url, utf8 } from '../keys/bytes.js';
import { INFO, aesGcmOpen, aesGcmSeal, importAesKey, openWrap } from '../keys/crypto.js';
import type { DeviceStore } from '../keys/device-store.js';
import { type SessionBuffer, createSessionBuffer } from './session-buffer.js';

/**
 * The relay of a Session in the page (SESSION-1, `docs/security/e2e.md`
 * « Sessions »): the tab follows a Session through the server, which only
 * forwards what the Runner sealed.
 *
 * - `session.keys`: the Session's key, wrapped by the Runner for each
 *   Appareil; the tab opens its own (`holderId` its public key) with the
 *   Runner's public key it authenticated at pairing, never a key the server
 *   sends, and keeps the key in memory as a non-extractable `CryptoKey`;
 * - `relay`: an event sealed under `"<sessionId>:<seq>"`, opened, checked
 *   against its schema, and fed to the Session's buffer. A frame that does
 *   not open, or holds another `seq`, is dropped with a console warning,
 *   never shown; one before the key waits for it;
 * - a gap in `seq` opens the Session again from the first missing one, once
 *   per missing `seq`; a socket open again (a reconnection) too;
 * - `sendInput`: the Pilote's input sealed under
 *   `"<sessionId>:input:<inputId>"`; sent again with the same `inputId`, the
 *   Runner hands it to the Moteur once. One whose ciphertext would exceed
 *   `INPUT_CIPHERTEXT_MAX` is refused in the page, never sent.
 *
 * A Session closed while a key or a frame is being opened keeps nothing of it.
 *
 * Nothing it decrypts leaves memory: no IndexedDB, no localStorage, no store
 * event; `closeSession` drops it.
 */

/** The page's socket, as the relay uses it (`store/connection.ts`). */
export interface RelaySocket {
  /** Sends on the open socket; false when there is none. */
  sendRelay(message: TabRelayClientMessage): boolean;
  onRelay(listener: (message: TabRelayServerMessage) => void): () => void;
  /** Each time a socket opens, the first one and each reconnection. */
  onOpen(listener: () => void): () => void;
}

/** One Session the tab follows. */
export interface SessionSubscription {
  readonly sessionId: string;
  /** Its decrypted events, ordered by `seq`, up to the first missing one. */
  events(): readonly EngineEvent[];
  /** The server's last refusal of its open or an input, until a frame comes. */
  error(): SessionRelayError | null;
  /** Called after each change of `events` or `error`. */
  onChange(listener: () => void): () => void;
}

/**
 * Why `sendInput` sent nothing: no key yet (the Session's keys not come), no
 * socket, or an input whose ciphertext would exceed the frame's limit (the
 * server would close the socket on it).
 */
export class SessionInputError extends Error {
  constructor(readonly code: 'no-key' | 'not-connected' | 'too-large') {
    super(`session relay: input not sent (${code})`);
    this.name = 'SessionInputError';
  }
}

export interface SessionRelay {
  /** Follows the Session from its first event; the same subscription while it is open. */
  openSession(sessionId: string): SessionSubscription;
  /** Seals the input and sends it; its `inputId` (drawn when not given), to send it again. */
  sendInput(sessionId: string, input: SessionInputPayload, inputId?: string): Promise<string>;
  /** Stops following the Session and drops what was decrypted. */
  closeSession(sessionId: string): void;
}

export interface SessionRelayOptions {
  readonly socket: RelaySocket;
  readonly devices: Pick<DeviceStore, 'getDevice'>;
  /** `console.warn` by default: a frame dropped, with its ids only. */
  readonly warn?: (message: string, detail: { sessionId: string; seq?: number }) => void;
}

/** The most frames held while the key has not come; the rest come again through a gap. */
const PENDING_MAX = 1000;

type Frame = Extract<TabRelayServerMessage, { type: 'relay' }>;
type Keys = Extract<TabRelayServerMessage, { type: 'session.keys' }>;

interface Followed {
  readonly subscription: SessionSubscription;
  readonly buffer: SessionBuffer;
  readonly listeners: Set<() => void>;
  key: CryptoKey | null;
  pending: Frame[];
  /** The last `fromSeq` the tab asked: a gap at it is the replay on its way. */
  asked: number;
  error: SessionRelayError | null;
  /** The Session's messages, handled one after the other. */
  chain: Promise<void>;
  closed: boolean;
}

/** A UUIDv7 (RFC 9562): 48 bits of milliseconds, the version, 74 random bits. */
export const newInputId = (now = Date.now()): string => {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let ms = now;
  for (let i = 5; i >= 0; i -= 1) {
    bytes[i] = ms % 256;
    ms = Math.floor(ms / 256);
  }
  bytes[6] = ((bytes[6] as number) & 0x0f) | 0x70;
  bytes[8] = ((bytes[8] as number) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

/** The relayed event without `raw`, should a Runner have sent it. */
const withoutRaw = (event: EngineEvent): EngineEvent => {
  if (!('raw' in event)) return event;
  const rest: Record<string, unknown> = { ...event };
  delete rest.raw;
  return rest as EngineEvent;
};

export const createSessionRelay = ({
  socket,
  devices,
  warn = (message, detail) => console.warn(message, detail),
}: SessionRelayOptions): SessionRelay => {
  const followed = new Map<string, Followed>();

  const changed = (session: Followed) => {
    for (const listener of session.listeners) listener();
  };

  const open = (sessionId: string, session: Followed) => {
    session.asked = session.buffer.missing();
    socket.sendRelay({ type: 'session.open', sessionId, fromSeq: session.asked });
  };

  const installKey = async (sessionId: string, session: Followed, { wraps }: Keys) => {
    const device = await devices.getDevice();
    if (session.closed) return;
    if (!device?.runnerPublicKey) return warn('session relay: no Runner key on this Appareil, keys dropped', { sessionId });
    const holderId = toBase64Url(device.publicKey);
    const wrap = wraps.find((candidate) => candidate.holderId === holderId);
    if (!wrap) return warn('session relay: no wrap for this Appareil, keys dropped', { sessionId });
    let raw: Uint8Array;
    try {
      raw = await openWrap(
        device.privateKey,
        device.runnerPublicKey,
        { enc: fromBase64Url(wrap.enc), ciphertext: fromBase64Url(wrap.wrappedKey), tag: fromBase64Url(wrap.tag) },
        INFO.sessionKey,
        utf8(`${sessionId}:${holderId}`),
      );
    } catch {
      return warn('session relay: the keys do not open, dropped', { sessionId });
    }
    let key: CryptoKey;
    try {
      if (session.closed) return;
      key = await importAesKey(raw);
    } finally {
      raw.fill(0);
    }
    // Closed while the key was opened: it stays out of the Session.
    if (session.closed) return;
    session.key = key;
    for (const frame of session.pending.splice(0)) await take(sessionId, session, frame);
  };

  /** The frame's event, or null when it does not open under its own `seq` or is outside the schema. */
  const openFrame = async (key: CryptoKey, sessionId: string, { seq, nonce, ciphertext }: Frame): Promise<EngineEvent | null> => {
    try {
      const plain = await aesGcmOpen(key, concat(fromBase64Url(nonce), fromBase64Url(ciphertext)), utf8(`${sessionId}:${seq}`));
      const event = zEngineEvent.safeParse(JSON.parse(new TextDecoder().decode(plain)));
      return event.success && event.data.seq === seq ? withoutRaw(event.data) : null;
    } catch {
      return null;
    }
  };

  const take = async (sessionId: string, session: Followed, frame: Frame) => {
    if (!session.key) {
      if (session.pending.length < PENDING_MAX) session.pending.push(frame);
      return;
    }
    const event = await openFrame(session.key, sessionId, frame);
    // Closed while the frame was opened: nothing of it is shown nor kept.
    if (session.closed) return;
    if (!event) return warn('session relay: a frame did not open, dropped', { sessionId, seq: frame.seq });
    const added = session.buffer.add(event);
    if (added === 'gap' && session.buffer.missing() !== session.asked) open(sessionId, session);
    if (added === 'added' || session.error) {
      session.error = null;
      changed(session);
    }
  };

  const handle = async (message: TabRelayServerMessage) => {
    const session = followed.get(message.sessionId);
    if (!session) return;
    const run = async () => {
      if (session.closed) return;
      switch (message.type) {
        case 'session.keys':
          return installKey(message.sessionId, session, message);
        case 'relay':
          return take(message.sessionId, session, message);
        case 'session.error':
          session.error = message.code;
          return changed(session);
      }
    };
    session.chain = session.chain.then(run).catch(() => warn('session relay: a frame could not be handled', { sessionId: message.sessionId }));
  };

  socket.onRelay((message) => void handle(message));
  socket.onOpen(() => {
    for (const [sessionId, session] of followed) open(sessionId, session);
  });

  return {
    openSession(sessionId) {
      const known = followed.get(sessionId);
      if (known) return known.subscription;
      const listeners = new Set<() => void>();
      const buffer = createSessionBuffer();
      const session: Followed = {
        buffer,
        listeners,
        key: null,
        pending: [],
        asked: 1,
        error: null,
        chain: Promise.resolve(),
        closed: false,
        subscription: {
          sessionId,
          events: () => buffer.events(),
          error: () => session.error,
          onChange(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
          },
        },
      };
      followed.set(sessionId, session);
      open(sessionId, session);
      return session.subscription;
    },

    async sendInput(sessionId, input, inputId = newInputId()) {
      const session = followed.get(sessionId);
      // The keys being opened come first.
      await session?.chain;
      if (!session?.key || session.closed) throw new SessionInputError('no-key');
      const plain = utf8(JSON.stringify(zSessionInputPayload.parse(input)));
      // The ciphertext is the plaintext and the 16 bytes of the tag.
      if (plain.length + 16 > INPUT_CIPHERTEXT_MAX) throw new SessionInputError('too-large');
      const sealed = await aesGcmSeal(session.key, plain, utf8(`${sessionId}:input:${inputId}`));
      if (session.closed) throw new SessionInputError('no-key');
      const sent = socket.sendRelay({
        type: 'session.input',
        sessionId,
        inputId,
        nonce: toBase64Url(sealed.subarray(0, 12)),
        ciphertext: toBase64Url(sealed.subarray(12)),
      });
      if (!sent) throw new SessionInputError('not-connected');
      return inputId;
    },

    closeSession(sessionId) {
      const session = followed.get(sessionId);
      if (!session) return;
      followed.delete(sessionId);
      session.closed = true;
      session.key = null;
      session.pending = [];
      session.buffer.clear();
      session.listeners.clear();
      socket.sendRelay({ type: 'session.close', sessionId });
    },
  };
};
