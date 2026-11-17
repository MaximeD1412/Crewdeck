import { z } from 'zod';
import { zEvent } from '../events/index.js';
import { zTabFolderCheck, zTabFolderChecked, zTabFolderError } from '../runner/folders.js';
import { zTabRelay, zTabSessionClose, zTabSessionError, zTabSessionInput, zTabSessionKeys, zTabSessionOpen } from '../runner/relay.js';
import { zSeq } from '../values.js';

/**
 * The messages of `/api/ws` (ADR 0007), JSON, each with its `type`. The
 * socket never carries a command that changes the state: those are REST.
 * RUNNER-2 adds the Runner's protocol; SESSION-1 the relay of a Session
 * (`runner/relay.ts`), `session.*` and `relay` both ways.
 */

/**
 * Client → server. `hello`: the last `seq` the page applied, `null` before any
 * snapshot; `ping`: every 25 s, a socket silent 60 s is closed; `visibility`:
 * on each `visibilitychange` of the tab (the push of ATOI-4 reads it).
 */
export const zClientMessage = z.discriminatedUnion('type', [
  z.object({ type: z.literal('hello'), lastSeq: zSeq.nullable() }),
  z.object({ type: z.literal('ping') }),
  z.object({ type: z.literal('visibility'), visible: z.boolean() }),
  zTabSessionOpen,
  zTabSessionClose,
  zTabSessionInput,
  zTabFolderCheck,
]);
export type ClientMessage = z.infer<typeof zClientMessage>;

/**
 * Server → client. `event`: one event, in `seq` order; `snapshot-required`:
 * the server no longer has what follows `lastSeq` (or got none), the page
 * fetches `GET /api/state` then sends `hello` with its `seq`; `live`: the
 * replay is over, what follows is live; `pong`: the answer to `ping`.
 */
export const zServerMessage = z.discriminatedUnion('type', [
  z.object({ type: z.literal('event'), event: zEvent }),
  z.object({ type: z.literal('snapshot-required') }),
  z.object({ type: z.literal('live') }),
  z.object({ type: z.literal('pong') }),
  zTabSessionKeys,
  zTabRelay,
  zTabSessionError,
  zTabFolderChecked,
  zTabFolderError,
]);
export type ServerMessage = z.infer<typeof zServerMessage>;

/** The close codes of the socket: 4401 no principal, or its session ended (logout, expiry), 4400 a message that is not one of `zClientMessage`, 4408 silent too long. */
export const WS_CLOSE = { unauthorized: 4401, invalidMessage: 4400, silent: 4408 } as const;
