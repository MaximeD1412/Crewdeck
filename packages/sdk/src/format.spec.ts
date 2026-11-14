import { formatDay, formatEuros, formatHour, formatNumber, formatPercent, formatRelative, formatWeekday, sameDay } from './format.js';

const NNBSP = ' ';
const NBSP = ' ';

/** A local date, so that the cases hold in any time zone. */
const local = (day: number, hour: number, minute = 0, second = 0) => new Date(2026, 10, day, hour, minute, second);

describe('formatRelative', () => {
  const now = local(20, 12);

  it.each([
    ['à l’instant under a minute', local(20, 11, 59, 30), "à l'instant"],
    ['minutes under an hour', local(20, 11, 56), 'il y a 4 min'],
    ['hours under a day', local(20, 10), 'il y a 2 h'],
    ['« hier » for the day before', local(19, 8), 'hier'],
    ['the day for anything older', local(12, 18), '12 nov.'],
    ['à l’instant for an instant slightly ahead', local(20, 12, 0, 5), "à l'instant"],
  ])('gives %s', (_case, instant, expected) => {
    expect(formatRelative(instant, now)).toBe(expected);
  });

  it('accepts an ISO instant', () => {
    expect(formatRelative(local(20, 11, 56).toISOString(), now)).toBe('il y a 4 min');
  });

  it('says « hier » for yesterday evening seen early the next morning, past a day', () => {
    expect(formatRelative(local(19, 23, 30), local(20, 0, 10))).toBe('il y a 40 min');
    expect(formatRelative(local(19, 0, 30), local(20, 6))).toBe('hier');
  });
});

describe('formatHour', () => {
  it('gives hours and minutes in 24 h', () => {
    expect(formatHour(local(12, 16, 40))).toBe('16:40');
    expect(formatHour(local(12, 9, 5).toISOString())).toBe('09:05');
  });
});

describe('formatWeekday', () => {
  it('gives the day of the week, lower case', () => {
    expect(formatWeekday(local(12, 16, 40))).toBe('jeudi');
    expect(formatWeekday(local(16, 8).toISOString())).toBe('lundi');
  });
});

describe('sameDay', () => {
  it('compares the local days of two instants', () => {
    expect(sameDay(local(12, 0, 5), local(12, 23, 55).toISOString())).toBe(true);
    expect(sameDay(local(12, 23, 55), local(13, 0, 5))).toBe(false);
  });
});

describe('formatDay', () => {
  it('gives the day and the short month of a YYYY-MM-DD day, in any time zone', () => {
    expect(formatDay('2026-11-12')).toBe('12 nov.');
    expect(formatDay('2026-01-01')).toBe('1 janv.');
  });
});

describe('formatNumber', () => {
  it('separates thousands with a narrow no-break space and decimals with a comma', () => {
    expect(formatNumber(12345)).toBe(`12${NNBSP}345`);
    expect(formatNumber(1234567.5)).toBe(`1${NNBSP}234${NNBSP}567,5`);
  });
});

describe('formatPercent', () => {
  it('gives a ratio as a rounded percentage after a no-break space', () => {
    expect(formatPercent(0.86)).toBe(`86${NBSP}%`);
    expect(formatPercent(0.8649)).toBe(`86${NBSP}%`);
  });
});

describe('formatEuros', () => {
  it('gives cents as euros with two decimals after a no-break space', () => {
    expect(formatEuros(180)).toBe(`1,80${NBSP}€`);
    expect(formatEuros(123456)).toBe(`1${NNBSP}234,56${NBSP}€`);
    expect(formatEuros(0)).toBe(`0,00${NBSP}€`);
  });
});
