/** A rate of the ECB: 1 EUR = `usdPerEur` USD on `day` (`YYYY-MM-DD`), as a decimal string. */
export interface FxRateOfDay {
  readonly day: string;
  readonly usdPerEur: string;
}

/** The rate of `day`, else the last known before it (a weekend, a holiday); `undefined` before the first one. `rates` in any order. */
export const rateFor = (rates: readonly FxRateOfDay[], day: string): string | undefined => {
  let best: FxRateOfDay | undefined;
  for (const rate of rates) if (rate.day <= day && (!best || rate.day > best.day)) best = rate;
  return best?.usdPerEur;
};

const DECIMAL = /^(\d+)(?:\.(\d+))?$/;

/**
 * `round(usdMicros / 1e6 / usdPerEur * 100)`, in integers so a half cent
 * rounds up whatever floats would make of it: `usdPerEur = r / 10^k`, so the
 * cents are `usdMicros * 10^k / (10^4 * r)`.
 */
const convert = (usdMicros: number, usdPerEur: string): number => {
  const match = DECIMAL.exec(usdPerEur);
  if (!match) throw new Error(`Not a rate: ${usdPerEur}`);
  const decimals = match[2] ?? '';
  const rate = BigInt(`${match[1]}${decimals}`);
  if (rate === 0n) throw new Error(`Not a rate: ${usdPerEur}`);
  const numerator = BigInt(usdMicros) * 10n ** BigInt(decimals.length);
  const denominator = 10_000n * rate;
  return Number((2n * numerator + denominator) / (2n * denominator));
};

/**
 * A spend of `usdMicros` micro-dollars on `day`, in euro cents at that day's
 * rate or the last known one (US-55: converted once, at write, the euro
 * always « estimé »); `null` while no rate is known for it.
 */
export const toEurCents = (usdMicros: number, day: string, rates: readonly FxRateOfDay[]): number | null => {
  const rate = rateFor(rates, day);
  return rate === undefined ? null : convert(usdMicros, rate);
};

/**
 * The day and the USD rate of the ECB's daily reference rates
 * (`eurofxref-daily.xml`): `<Cube time='YYYY-MM-DD'>` and
 * `<Cube currency='USD' rate='x'/>`. Throws on a file without them.
 */
export const parseEcbDaily = (xml: string): FxRateOfDay => {
  const day = /<Cube\s+time=["'](\d{4}-\d{2}-\d{2})["']/.exec(xml)?.[1];
  if (!day) throw new Error('The ECB file has no day.');
  const usdPerEur = /<Cube\s+currency=["']USD["']\s+rate=["']([^"']*)["']/.exec(xml)?.[1];
  if (!usdPerEur || !DECIMAL.test(usdPerEur) || Number(usdPerEur) <= 0) throw new Error('The ECB file has no USD rate.');
  return { day, usdPerEur };
};
