import { z } from 'zod';
import { zMe } from './me.js';
import { zRunner } from './runner.js';
import { zAccountSettings } from './settings.js';
import { zSeq } from '../values.js';

/**
 * The slices of `GET /api/state`, one per key the server's
 * `STATE_CONTRIBUTORS` registers: each module's ticket adds its own here, next
 * to its contributor (a test checks both lists are the same).
 */
export const STATE_SLICES = {
  pilot: zMe,
  /** The Pilote's Runner, `null` while none is linked. */
  runner: zRunner.nullable(),
  /** The Paramètres of the account. */
  settings: zAccountSettings,
} as const;
export type StateKey = keyof typeof STATE_SLICES;

/**
 * `GET /api/state`: the snapshot of everything the page shows (ADR 0007),
 * read in one transaction with the `seq` it reflects; the page applies it
 * then sends `hello { lastSeq: seq }`.
 */
export const zState = z.object({ seq: zSeq, ...STATE_SLICES });
export type State = z.infer<typeof zState>;
