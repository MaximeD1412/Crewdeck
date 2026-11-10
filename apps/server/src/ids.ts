import { v7 } from 'uuid';

/** A new row's id (ADR 0008): a UUIDv7, generated in code, ordered by creation time. */
export const newId = (): string => v7();
