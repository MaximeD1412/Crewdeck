import { z } from 'zod';
import { zId } from '../values.js';
import { withSeq } from './commands.js';

/**
 * The steps of « Premiers pas » (US-2), in order: the Runner, the Comptes IA
 * (RUNNER-7), the Projets (PROJET-2), then `done`. Every page but
 * `/connexion` and `/demarrage` leads to `/demarrage` until `done`.
 */
export const GETTING_STARTED_STEPS = ['runner', 'ai-accounts', 'projects', 'done'] as const;
export const zGettingStartedStep = z.enum(GETTING_STARTED_STEPS);
export type GettingStartedStep = z.infer<typeof zGettingStartedStep>;

/** The step after `step`; `done` stays `done`. */
export const nextGettingStartedStep = (step: GettingStartedStep): GettingStartedStep =>
  GETTING_STARTED_STEPS[Math.min(GETTING_STARTED_STEPS.indexOf(step) + 1, GETTING_STARTED_STEPS.length - 1)] as GettingStartedStep;

/**
 * `GET /api/me`: the signed-in Pilote, 401 `auth.required` for nobody (the
 * page then goes to `/connexion`), with the step of « Premiers pas » they
 * are at.
 */
export const zMe = z.object({
  id: zId,
  login: z.string().min(1),
  avatarUrl: z.url().nullable(),
  /** IANA, the browser's at the first sign-in. */
  timeZone: z.string().min(1),
  gettingStartedStep: zGettingStartedStep,
});
export type Me = z.infer<typeof zMe>;

/**
 * `POST /api/me/getting-started/advance` (session): the step the page shows
 * and the `seq` it acted on; answers the Pilote at the next step, 409
 * `realtime.stale` when `from` is no longer their step, 422
 * `getting-started.runner-not-linked` leaving `runner` without a Runner,
 * 422 `getting-started.no-usable-engine` leaving `ai-accounts` without a
 * usable Compte IA (`isUsableAccount`).
 */
export const zGettingStartedAdvance = withSeq(z.object({ from: zGettingStartedStep.exclude(['done']) }));
export type GettingStartedAdvance = z.infer<typeof zGettingStartedAdvance>;
