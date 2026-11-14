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
