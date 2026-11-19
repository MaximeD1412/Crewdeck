/** The longest delay `setTimeout` takes (about 24.8 days); a later instant waits in steps. */
const MAX_DELAY_MS = 2 ** 31 - 1;

export interface Deadline {
  /** Waits for the instant `next` gives now, instead of the one before. */
  readonly schedule: () => void;
  readonly stop: () => void;
}

/**
 * Calls `due` at the instant `next` gives, then waits for the next one: what
 * a page shows that changes with time alone (a window of a Compte IA that
 * resets), with one timer to a known instant, never polling (ADR 0007).
 * `next` is `null` while there is nothing to wait for; `schedule` again when
 * what it reads changes.
 */
export const createDeadline = (next: (now: Date) => Date | null, due: () => void): Deadline => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stop = () => {
    clearTimeout(timer);
    timer = undefined;
  };
  const schedule = () => {
    stop();
    const at = next(new Date());
    if (!at) return;
    const delay = Math.max(0, at.getTime() - Date.now());
    timer = setTimeout(() => {
      if (delay <= MAX_DELAY_MS) due();
      schedule();
    }, Math.min(delay, MAX_DELAY_MS));
  };
  return { schedule, stop };
};
