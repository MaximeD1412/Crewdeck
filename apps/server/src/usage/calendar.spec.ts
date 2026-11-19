import { dayIn, monthOf, startOfDayIn } from './calendar.js';

describe('the Pilote’s calendar', () => {
  it('reads the day of an instant in a time zone', () => {
    expect(dayIn(new Date('2026-11-30T23:30:00.000Z'), 'Europe/Paris')).toBe('2026-12-01');
    expect(dayIn(new Date('2026-11-30T23:30:00.000Z'), 'UTC')).toBe('2026-11-30');
  });

  it('gives a month’s first day and the next one’s', () => {
    expect(monthOf('2026-11-14')).toEqual({ from: '2026-11-01', to: '2026-12-01' });
    expect(monthOf('2026-12-31')).toEqual({ from: '2026-12-01', to: '2027-01-01' });
  });

  it('gives the instant a day starts at in a time zone, summer time or not', () => {
    expect(startOfDayIn('2026-12-01', 'Europe/Paris').toISOString()).toBe('2026-11-30T23:00:00.000Z');
    expect(startOfDayIn('2026-07-01', 'Europe/Paris').toISOString()).toBe('2026-06-30T22:00:00.000Z');
    expect(startOfDayIn('2026-12-01', 'America/New_York').toISOString()).toBe('2026-12-01T05:00:00.000Z');
    expect(startOfDayIn('2026-12-01', 'Pacific/Auckland').toISOString()).toBe('2026-11-30T11:00:00.000Z');
    expect(startOfDayIn('2026-12-01', 'UTC').toISOString()).toBe('2026-12-01T00:00:00.000Z');
  });
});
