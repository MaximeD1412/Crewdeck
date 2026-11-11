import { randomInt } from 'node:crypto';
import { CROCKFORD_ALPHABET, LINK_CODE_SHORT_ID_LENGTH } from '@crewdeck/contracts';
import { v7 } from 'uuid';

/** A new row's id (ADR 0008): a UUIDv7, generated in code, ordered by creation time. */
export const newId = (): string => v7();

/** A code's short id (a Runner's link code, a new Appareil's): 4 Crockford characters from the system's random source. */
export const drawShortId = (): string =>
  Array.from({ length: LINK_CODE_SHORT_ID_LENGTH }, () => CROCKFORD_ALPHABET[randomInt(CROCKFORD_ALPHABET.length)]).join('');
