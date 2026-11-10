import { z } from 'zod';

/** An id: a UUIDv7 string (ADR 0008). */
export const zId = z.uuid({ version: 'v7' });
export type Id = z.infer<typeof zId>;
