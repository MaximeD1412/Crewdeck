import { type Me, zMe } from '../api/me.js';
import { registerEventPayload } from './index.js';

/** `pilot.upserted`: the Pilote as `GET /api/me` returns it. */
export const zPilotEventPayload = registerEventPayload('pilot', zMe);

declare module './index.js' {
  interface EventPayloads {
    pilot: Me;
  }
}
