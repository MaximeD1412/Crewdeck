/** The day (`YYYY-MM-DD`) of `instant` in `timeZone`, an IANA zone. */
export const dayIn = (instant: Date, timeZone: string): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(instant);

/** The calendar month of `day`: its first day, and the first day of the next month (excluded). */
export const monthOf = (day: string): { from: string; to: string } => {
  const [year, month] = day.split('-').map(Number) as [number, number];
  const pad = (n: number) => String(n).padStart(2, '0');
  const next = month === 12 ? `${year + 1}-01` : `${year}-${pad(month + 1)}`;
  return { from: `${year}-${pad(month)}-01`, to: `${next}-01` };
};

/** How far `timeZone`'s wall clock is ahead of UTC at `instant`, in milliseconds. */
const offsetAt = (instant: Date, timeZone: string): number => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value);
  return Date.UTC(part('year'), part('month') - 1, part('day'), part('hour'), part('minute'), part('second')) - instant.getTime();
};

/** The instant `day` (`YYYY-MM-DD`) starts at in `timeZone`: its midnight there. */
export const startOfDayIn = (day: string, timeZone: string): Date => {
  const midnight = new Date(`${day}T00:00:00.000Z`).getTime();
  // The offset of the guess, then of the instant it gives: right across a change of time.
  const guess = midnight - offsetAt(new Date(midnight), timeZone);
  return new Date(midnight - offsetAt(new Date(guess), timeZone));
};
