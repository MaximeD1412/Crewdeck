import { createDeadline } from './deadline.js';

const AT = new Date('2026-11-11T14:00:00.000Z');
const after = (ms: number) => new Date(AT.getTime() + ms);

describe('createDeadline', () => {
  beforeEach(() => vi.useFakeTimers({ now: AT, toFake: ['Date', 'setTimeout', 'clearTimeout'] }));
  afterEach(() => vi.useRealTimers());

  it('calls `due` at each instant `next` gives, and not before', () => {
    const instants = [after(1_000), after(5_000)];
    const due = vi.fn<() => void>();
    createDeadline((now) => instants.find((instant) => instant > now) ?? null, due).schedule();

    vi.advanceTimersByTime(999);
    expect(due).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(due).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(4_000);
    expect(due).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(60_000);
    expect(due).toHaveBeenCalledTimes(2);
  });

  it('waits for the new instant once scheduled again, and for nothing once stopped', () => {
    let instant: Date | null = after(10_000);
    const due = vi.fn<() => void>();
    const deadline = createDeadline((now) => (instant && instant > now ? instant : null), due);
    deadline.schedule();

    instant = after(2_000);
    deadline.schedule();
    vi.advanceTimersByTime(2_000);
    expect(due).toHaveBeenCalledTimes(1);

    instant = after(4_000);
    deadline.schedule();
    deadline.stop();
    vi.advanceTimersByTime(10_000);
    expect(due).toHaveBeenCalledTimes(1);
  });

  it('waits for an instant beyond the longest delay of a timer', () => {
    const month = 31 * 24 * 3_600_000;
    const due = vi.fn<() => void>();
    createDeadline((now) => (after(month) > now ? after(month) : null), due).schedule();

    vi.advanceTimersByTime(month - 1);
    expect(due).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(due).toHaveBeenCalledTimes(1);
  });
});
