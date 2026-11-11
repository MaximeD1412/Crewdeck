import { z } from 'zod';
import { zRunnerArch, zRunnerOs } from '../runner/hello.js';
import { zId, zInstant } from '../values.js';

/** « en ligne » while its heartbeats come, « hors ligne » 45 s after the last one or once its socket closes. */
export const RUNNER_STATES = ['online', 'offline'] as const;
export const zRunnerState = z.enum(RUNNER_STATES);
export type RunnerState = z.infer<typeof zRunnerState>;

/**
 * `GET /api/runner`: the Pilote's current Runner (one per Pilote), 404
 * `runner.not-linked` when none is linked; the `runner` slice of
 * `GET /api/state` (`null` then) and the payload of `runner.upserted`. Its
 * machine, as its last `hello` described it.
 */
export const zRunner = z.object({
  id: zId,
  machine: z.string().min(1),
  os: zRunnerOs,
  arch: zRunnerArch,
  wsl: z.boolean(),
  runnerVersion: z.string().min(1),
  state: zRunnerState,
  lastSeenAt: zInstant,
  linkedAt: zInstant,
});
export type Runner = z.infer<typeof zRunner>;

/**
 * `GET /runner/latest`, public: the version of the Runner's binaries this
 * server serves (its image's `CREWDECK_COMMIT`), which `crewdeck-runner
 * status` and `update` compare with their own (RUNNER-8).
 */
export const zRunnerLatest = z.object({ version: z.string().min(1) });
export type RunnerLatest = z.infer<typeof zRunnerLatest>;
