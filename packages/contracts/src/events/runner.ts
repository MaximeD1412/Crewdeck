import { type Runner, zRunner } from '../api/runner.js';
import { registerEventPayload } from './index.js';

/** `runner.upserted`: the Runner as `GET /api/runner` returns it, on each change of its state or of its machine. */
export const zRunnerEventPayload = registerEventPayload('runner', zRunner);

declare module './index.js' {
  interface EventPayloads {
    runner: Runner;
  }
}
