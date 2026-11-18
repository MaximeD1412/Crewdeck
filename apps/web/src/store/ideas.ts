import { IDEA_CLOSED_STATES, type Idea } from '@crewdeck/contracts';

/** How long the `ideas` slice keeps an Idée merged or rejected, as `GET /api/state`. */
export const CLOSED_IDEAS_KEPT_DAYS = 90;
const DAY = 24 * 60 * 60 * 1000;
const CLOSED: ReadonlySet<string> = new Set(IDEA_CLOSED_STATES);

/** What the `ideas` slice holds after an event: every Idée not merged nor rejected, and those changed in the last 90 days. */
export const holdsIdea = (idea: Pick<Idea, 'state' | 'updatedAt'>, now: Date = new Date()): boolean =>
  !CLOSED.has(idea.state) || now.getTime() - Date.parse(idea.updatedAt) <= CLOSED_IDEAS_KEPT_DAYS * DAY;
