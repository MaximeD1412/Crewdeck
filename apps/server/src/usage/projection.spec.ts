import { dayIn, monthOf } from './calendar.js';
import { project } from './projection.js';

const at = (iso: string) => new Date(iso);
const WEEK_RESETS = at('2026-11-16T07:00:00Z'); // a Monday
const measure = (measuredAt: string, usedPercent: number, resetsAt = WEEK_RESETS) => ({ measuredAt: at(measuredAt), usedPercent, resetsAt });

describe('project', () => {
  const now = at('2026-11-11T14:00:00Z'); // a Wednesday

  it('runs out before the reset at a steady pace: exhaustsAt = now + (100 - used) / pace', () => {
    // 2 % an hour over the last 10 hours, 62 % used: 19 hours left, Thursday 09:00 UTC.
    const measures = [measure('2026-11-11T04:00:00Z', 42), measure('2026-11-11T09:00:00Z', 52), measure('2026-11-11T14:00:00Z', 62)];
    expect(project('week', measures, now)).toEqual({ exhaustsAt: at('2026-11-12T09:00:00Z'), holdsUntilReset: false, atReset: 100 });
  });

  it('knows no pace from one measure', () => {
    expect(project('week', [measure('2026-11-11T14:00:00Z', 62)], now)).toEqual({ exhaustsAt: null, holdsUntilReset: false, atReset: null });
  });

  it('knows no pace from measures over less than 30 minutes', () => {
    const measures = [measure('2026-11-11T13:35:00Z', 60), measure('2026-11-11T14:00:00Z', 62)];
    expect(project('week', measures, now)).toEqual({ exhaustsAt: null, holdsUntilReset: false, atReset: null });
  });

  it('holds until the reset when the pace runs out after it', () => {
    // 0.1 % an hour, 62 % used: 380 hours left, after Monday 07:00, 113 hours away: 73.3 % then.
    const measures = [measure('2026-11-11T04:00:00Z', 61), measure('2026-11-11T14:00:00Z', 62)];
    expect(project('week', measures, now)).toEqual({ exhaustsAt: null, holdsUntilReset: true, atReset: 73.3 });
  });

  it('holds until the reset when nothing was used since the first measure', () => {
    const measures = [measure('2026-11-11T04:00:00Z', 62), measure('2026-11-11T14:00:00Z', 62)];
    expect(project('week', measures, now)).toEqual({ exhaustsAt: null, holdsUntilReset: true, atReset: 62 });
  });

  it('reads only the last 24 hours', () => {
    // The measure of two days ago would make the pace 0.7 %/h; the last 24 h give 2 %/h.
    const measures = [measure('2026-11-09T14:00:00Z', 30), measure('2026-11-11T04:00:00Z', 42), measure('2026-11-11T14:00:00Z', 62)];
    expect(project('week', measures, now).exhaustsAt).toEqual(at('2026-11-12T09:00:00Z'));
  });

  it('reads only the current window: a five-hour window that reset two hours ago starts over', () => {
    const resetAt = at('2026-11-11T12:00:00Z');
    const nextReset = at('2026-11-11T17:00:00Z');
    const measures = [measure('2026-11-11T10:00:00Z', 90, resetAt), measure('2026-11-11T13:00:00Z', 10, nextReset), measure('2026-11-11T14:00:00Z', 30, nextReset)];
    // 20 %/h from 30 %: 3.5 hours left, after the 17:00 reset, 3 hours away: 90 % then.
    expect(project('five-hour', measures, now)).toEqual({ exhaustsAt: null, holdsUntilReset: true, atReset: 90 });
  });

  it('says nothing of a window already used up: it is reached', () => {
    const measures = [measure('2026-11-11T12:00:00Z', 80), measure('2026-11-11T14:00:00Z', 100)];
    expect(project('week', measures, now)).toEqual({ exhaustsAt: null, holdsUntilReset: false, atReset: null });
  });
});

describe('dayIn', () => {
  it('is the day in the Pilote’s time zone', () => {
    expect(dayIn(at('2026-11-30T23:30:00Z'), 'Europe/Paris')).toBe('2026-12-01');
    expect(dayIn(at('2026-11-30T23:30:00Z'), 'UTC')).toBe('2026-11-30');
    expect(dayIn(at('2026-12-01T03:00:00Z'), 'America/New_York')).toBe('2026-11-30');
  });
});

describe('monthOf', () => {
  it('is the first day of the month and of the next one', () => {
    expect(monthOf('2026-11-14')).toEqual({ from: '2026-11-01', to: '2026-12-01' });
    expect(monthOf('2026-12-31')).toEqual({ from: '2026-12-01', to: '2027-01-01' });
  });
});
