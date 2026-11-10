import { z } from 'zod';

/**
 * The state a signal carries (`design/DESIGN.md`, « Colors »): `accent` live
 * or current, `go` done, `caution` waits, `halt` blocked or failed.
 */
export const zTone = z.enum(['neutral', 'accent', 'go', 'caution', 'halt']).meta({ title: 'Tone' });
export type Tone = z.infer<typeof zTone>;
