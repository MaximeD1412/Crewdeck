import { conflict } from '../errors/app-error.js';
import { MESSAGES } from '../errors/messages.js';

/**
 * A command is fresh when it carries the `seq` of the resource's last change
 * (its row's `lastSeq`), or a later one: the page acted on what is still
 * true. Older, the resource changed since the page showed it: 409
 * `realtime.stale` (ADR 0007), the page then reads the new state.
 */
export const assertFresh = (lastSeq: bigint, commandSeq: bigint): void => {
  if (commandSeq < lastSeq) throw conflict('realtime.stale', MESSAGES['realtime.stale']);
};
