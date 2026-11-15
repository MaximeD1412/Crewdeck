import { type ProjectProcess, zProjectProcess } from '../api/process.js';
import { registerEventPayload } from './index.js';

/** `process.upserted`: a Projet's whole Process, as `GET /api/projects/:id/process` returns it, on each version or draft written. */
export const zProcessEventPayload = registerEventPayload('process', zProjectProcess);

declare module './index.js' {
  interface EventPayloads {
    process: ProjectProcess;
  }
}
