import { type RunnerLink, zRunnerLink } from '../api/runner-link.js';
import { registerEventPayload } from './index.js';

/** `runner-link.upserted`: the Pilote's last link code as the page sees it, on each change of its state. */
export const zRunnerLinkEventPayload = registerEventPayload('runner-link', zRunnerLink);

declare module './index.js' {
  interface EventPayloads {
    'runner-link': RunnerLink;
  }
}
