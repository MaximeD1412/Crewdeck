import { z } from 'zod';

/**
 * A field's dictation (US-57, ADR 0007), as the core gives it to the
 * Composant that holds the field: `available` when the browser has the Web
 * Speech API (without it, no button at all), `state` and the seconds since
 * the dictation began, `error` why the last one ended (« Micro refusé… »), or
 * `null`, and `notice` while the first dictation of this Appareil runs: the
 * line that says the browser's own service hears the audio (risk SEC-9). The
 * Composant asks with `dictate-start` (the text its field holds, which the
 * transcript follows) and `dictate-stop`; the core never lets a Skin touch
 * the microphone.
 */
export const zDictation = z.object({
  available: z.boolean(),
  state: z.enum(['idle', 'dictating']),
  elapsedSeconds: z.number().int().nonnegative(),
  error: z.string().min(1).nullable(),
  notice: z.boolean(),
});
export type Dictation = z.infer<typeof zDictation>;

/** The actions of a field that dictates: the text it holds when the Pilote asks, then stop. */
export const DICTATION_ACTIONS = {
  'dictate-start': z.object({ text: z.string() }),
  'dictate-stop': z.object({}),
} as const;

/** The examples' dictations. */
export const DICTATION_EXAMPLES = {
  idle: { available: true, state: 'idle', elapsedSeconds: 0, error: null, notice: false },
  dictating: { available: true, state: 'dictating', elapsedSeconds: 7, error: null, notice: false },
  firstTime: { available: true, state: 'dictating', elapsedSeconds: 2, error: null, notice: true },
  refused: { available: true, state: 'idle', elapsedSeconds: 0, error: 'Micro refusé : autorise-le dans ton navigateur.', notice: false },
  missing: { available: false, state: 'idle', elapsedSeconds: 0, error: null, notice: false },
} as const satisfies Record<string, Dictation>;
