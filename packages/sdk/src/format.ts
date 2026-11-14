/**
 * The formatters of times and numbers (`design/DESIGN.md`, « Copy »; ADR
 * 0008): French, in the browser's time zone.
 */

const LOCALE = 'fr-FR';
const NBSP = ' ';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** An instant: a `Date` or an ISO 8601 string (`zInstant`). */
export type Instant = Date | string;

const toDate = (instant: Instant): Date => (typeof instant === 'string' ? new Date(instant) : instant);

const dayMonth = new Intl.DateTimeFormat(LOCALE, { day: 'numeric', month: 'short' });
const dayMonthUtc = new Intl.DateTimeFormat(LOCALE, { day: 'numeric', month: 'short', timeZone: 'UTC' });
const hourMinute = new Intl.DateTimeFormat(LOCALE, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const decimal = new Intl.NumberFormat(LOCALE);
const twoDecimals = new Intl.NumberFormat(LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const integer = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 });

const isDayBefore = (date: Date, now: Date): boolean => {
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  return (
    date.getFullYear() === yesterday.getFullYear() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getDate() === yesterday.getDate()
  );
};

/**
 * « à l'instant » under a minute, « il y a 4 min » under an hour, « il y a
 * 2 h » under a day, « hier » for the day before, then « 12 nov. ».
 */
export const formatRelative = (instant: Instant, now: Date = new Date()): string => {
  const date = toDate(instant);
  const elapsed = now.getTime() - date.getTime();
  if (elapsed < MINUTE) return "à l'instant";
  if (elapsed < HOUR) return `il y a ${Math.floor(elapsed / MINUTE)} min`;
  if (elapsed < DAY) return `il y a ${Math.floor(elapsed / HOUR)} h`;
  if (isDayBefore(date, now)) return 'hier';
  return dayMonth.format(date);
};

/** « 16:40 ». */
export const formatHour = (instant: Instant): string => hourMinute.format(toDate(instant));

/** « 3 nov. » for an instant, its day in the browser's time zone. */
export const formatDate = (instant: Instant): string => dayMonth.format(toDate(instant));

/** « 12 nov. » for a `YYYY-MM-DD` day (`zDay`), never shifted by the time zone. */
export const formatDay = (day: string): string => {
  const [year, month, date] = day.split('-').map(Number) as [number, number, number];
  return dayMonthUtc.format(new Date(Date.UTC(year, month - 1, date)));
};

/** « 12 345,5 »: a narrow no-break space for thousands, a comma for decimals. */
export const formatNumber = (n: number): string => decimal.format(n);

/** « 86 % » for the ratio 0.86, rounded, after a no-break space. */
export const formatPercent = (ratio: number): string => `${integer.format(ratio * 100)}${NBSP}%`;

/** « 1,80 € » for 180 cents, after a no-break space. */
export const formatEuros = (cents: number): string => `${twoDecimals.format(cents / 100)}${NBSP}€`;
