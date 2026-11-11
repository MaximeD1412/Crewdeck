import type { z } from 'zod';
import { zSeq } from '../values.js';

/**
 * A command's body with the `seq` of the resource the page acted on (ADR
 * 0007): the server answers 409 `realtime.stale` when the resource changed
 * since (a later `seq`).
 */
export const withSeq = <Shape extends z.ZodRawShape>(schema: z.ZodObject<Shape>) => schema.extend({ seq: zSeq });
