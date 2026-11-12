import { z } from 'zod';
import { zAiAccount } from './ai-accounts.js';
import { zDevice } from './devices.js';
import { zMe } from './me.js';
import { REPOSITORIES_MAX, zProject, zRepository } from './projects.js';
import { zRunner } from './runner.js';
import { zRunnerLink } from './runner-link.js';
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
  /** The Pilote's last link code (RUNNER-3), `null` before any: « Premiers pas » follows it. */
  'runner-link': zRunnerLink.nullable(),
  /** The Pilote's Comptes IA, one per Moteur their Runner reported (RUNNER-7). */
  'ai-account': z.array(zAiAccount),
  /** The Pilote's Appareils (E2E-2), newest first; `current` is `false`, each page sets its own. */
  devices: z.array(zDevice),
  /** The Pilote's Projets (PROJET-2), by name. */
  projects: z.array(zProject),
  /** The Dépôts GitHub their installations reach and they do not follow yet (PROJET-2), by name, at most `REPOSITORIES_MAX`. */
  repositories: z.array(zRepository).max(REPOSITORIES_MAX),
} as const;
export type StateKey = keyof typeof STATE_SLICES;

/**
 * `GET /api/state`: the snapshot of everything the page shows (ADR 0007),
 * read in one transaction with the `seq` it reflects; the page applies it
 * then sends `hello { lastSeq: seq }`.
 */
export const zState = z.object({ seq: zSeq, ...STATE_SLICES });
export type State = z.infer<typeof zState>;
