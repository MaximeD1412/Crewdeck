import { type Idea, zIdea } from '../api/ideas.js';
import { registerEventPayload } from './index.js';

/** `idea.upserted`: the Idée as `GET /api/ideas` returns it, its texts sealed, when noted or changed. */
export const zIdeaEventPayload = registerEventPayload('idea', zIdea);

declare module './index.js' {
  interface EventPayloads {
    idea: Idea;
  }
}
