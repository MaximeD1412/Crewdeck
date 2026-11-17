import { z } from 'zod';
import { zBytes, zBytes32 } from '../keys/pairing.js';
import { zId } from '../values.js';
import { runnerMessage } from './envelope.js';

/**
 * The relay of a Session (SESSION-1, ADR 0003, `docs/security/e2e.md`
 * « Sessions »): what the agent and the Pilote say travels between the Runner
 * and the tabs end-to-end encrypted, under the Session's key. The server
 * forwards each frame to the tab that asked for it, or to every tab of the
 * Session, and keeps none: it reads only the ids, the `seq` and the sizes.
 *
 * - tab → server: `session.open` (from `fromSeq`), `session.close`,
 *   `session.input`;
 * - server → Runner: `session.replay`, `session.input`, each with the `tabId`
 *   the server gave the tab's socket;
 * - Runner → server: `session.keys`, `relay`, with the `tabId` of a replay,
 *   without one for the live frames;
 * - server → tab: `session.keys`, `relay` (the same, without `tabId`), and
 *   `session.error`.
 *
 * Byte strings are base64url without padding. A frame's `ciphertext` is its
 * AES-256-GCM ciphertext and tag, `nonce` its 12 bytes; its additional data is
 * `"<sessionId>:<seq>"`, an input's `"<sessionId>:input:<inputId>"`.
 */

/** The HPKE `info` of a Session key's wrap; its additional data is `"<sessionId>:<holderId>"`. */
export const SESSION_KEY_INFO = 'crewdeck/v1/session-key';

/** The longest ciphertext of a relayed event: what the Runner's log reads in one line. */
export const RELAY_CIPHERTEXT_MAX = 16 * 1024 * 1024;

/** The longest ciphertext of the Pilote's input (a message, an answer). */
export const INPUT_CIPHERTEXT_MAX = 256 * 1024;

/** The most wraps one `session.keys` carries: one per Appareil. */
export const SESSION_KEY_WRAPS_MAX = 64;

/** A Session's `seq`: 1, 2, … in the order of its log. */
export const zRelaySeq = z.int().positive();

/** A frame's AES-GCM nonce. */
export const zNonce = zBytes(12, 12);

/**
 * The Session key wrapped for one holder: an authenticated wrap from the
 * Runner (`sealWrap`), its `holderId` the holder's X25519 public key, which
 * the Appareil checks is its own; `wrappedKey` is HPKE's ciphertext of the
 * 32-byte key (48 bytes), `tag` the Runner's.
 */
export const zSessionKeyWrap = z.object({ holderId: zBytes32, enc: zBytes32, wrappedKey: zBytes(48, 48), tag: zBytes32 });
export type SessionKeyWrap = z.infer<typeof zSessionKeyWrap>;

const keysShape = { sessionId: zId, wraps: z.array(zSessionKeyWrap).min(1).max(SESSION_KEY_WRAPS_MAX) };
const relayShape = { sessionId: zId, seq: zRelaySeq, nonce: zNonce, ciphertext: zBytes(16, RELAY_CIPHERTEXT_MAX) };
const inputShape = { sessionId: zId, inputId: zId, nonce: zNonce, ciphertext: zBytes(16, INPUT_CIPHERTEXT_MAX) };

/** Server → Runner: send the tab `tabId` the Session's key, then its logged events from `fromSeq` (included). */
export const zSessionReplay = runnerMessage('session.replay', { sessionId: zId, tabId: zId, fromSeq: zRelaySeq });
export type SessionReplay = z.infer<typeof zSessionReplay>;

/** Server → Runner: the Pilote's input from the tab `tabId`, sealed under the Session's key; one `inputId` is handled once. */
export const zSessionInput = runnerMessage('session.input', { ...inputShape, tabId: zId });
export type SessionInput = z.infer<typeof zSessionInput>;

/** Runner → server: the Session's key for its holders, for the tab `tabId` of a replay, else for every tab of the Session. */
export const zSessionKeys = runnerMessage('session.keys', { ...keysShape, tabId: zId.optional() });
export type SessionKeys = z.infer<typeof zSessionKeys>;

/** Runner → server: one event of the Session's log, for the tab `tabId` of a replay, else live for every tab of the Session. */
export const zRelay = runnerMessage('relay', { ...relayShape, tabId: zId.optional() });
export type Relay = z.infer<typeof zRelay>;

/** Tab → server: follow the Session, from `fromSeq` (1 for all of it). */
export const zTabSessionOpen = z.object({ type: z.literal('session.open'), sessionId: zId, fromSeq: zRelaySeq });
/** Tab → server: stop following the Session. */
export const zTabSessionClose = z.object({ type: z.literal('session.close'), sessionId: zId });
/** Tab → server: the Pilote's input, sealed in the tab, its `inputId` a UUIDv7 the tab draws. */
export const zTabSessionInput = z.object({ type: z.literal('session.input'), ...inputShape });

/** Server → tab: the Session's key, wrapped for each holder. */
export const zTabSessionKeys = z.object({ type: z.literal('session.keys'), ...keysShape });
/** Server → tab: one event of the Session. */
export const zTabRelay = z.object({ type: z.literal('relay'), ...relayShape });

/** Why the server refuses a Session's open or input: not the Pilote's (or no such Session), or its Runner is offline. */
export const SESSION_RELAY_ERRORS = ['session.not-found', 'session.runner-offline'] as const;
export const zSessionRelayError = z.enum(SESSION_RELAY_ERRORS);
export type SessionRelayError = z.infer<typeof zSessionRelayError>;

/** Server → tab: the open or the input of `sessionId` failed. An offline Runner keeps the open: its replay comes once it is back. */
export const zTabSessionError = z.object({ type: z.literal('session.error'), sessionId: zId, code: zSessionRelayError });

export const zTabRelayClientMessage = z.discriminatedUnion('type', [zTabSessionOpen, zTabSessionClose, zTabSessionInput]);
export type TabRelayClientMessage = z.infer<typeof zTabRelayClientMessage>;
export const zTabRelayServerMessage = z.discriminatedUnion('type', [zTabSessionKeys, zTabRelay, zTabSessionError]);
export type TabRelayServerMessage = z.infer<typeof zTabRelayServerMessage>;
