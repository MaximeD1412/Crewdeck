import { parseEcbDaily, rateFor, toEurCents } from './fx.js';

const RATES = [
  { day: '2026-11-09', usdPerEur: '1.0800' },
  { day: '2026-11-10', usdPerEur: '1.0842' },
  { day: '2026-11-12', usdPerEur: '1.1000' },
];

describe('rateFor', () => {
  it('takes the rate of the spend’s day', () => {
    expect(rateFor(RATES, '2026-11-10')).toBe('1.0842');
  });

  it('takes the last known rate before a day without one (a weekend, a holiday)', () => {
    expect(rateFor(RATES, '2026-11-11')).toBe('1.0842');
    expect(rateFor(RATES, '2026-11-15')).toBe('1.1000');
  });

  it('has none before the first known rate', () => {
    expect(rateFor(RATES, '2026-11-08')).toBeUndefined();
    expect(rateFor([], '2026-11-10')).toBeUndefined();
  });
});

describe('toEurCents', () => {
  it('converts micro-dollars at the day’s rate, round(usdMicros / 1e6 / usdPerEur * 100)', () => {
    // 21.60 € at 1.0842 USD per EUR: 23.418720 $.
    expect(toEurCents(23_418_720, '2026-11-10', RATES)).toBe(2160);
    expect(toEurCents(1_840_000, '2026-11-10', RATES)).toBe(Math.round(1_840_000 / 1e6 / 1.0842 * 100));
  });

  it('rounds half a cent up and below half down', () => {
    // 1 $ at 2 USD per EUR = 50 cents; 0.01 $ = 0.5 cent → 1; 0.009999 $ = 0.49995 cent → 0.
    const two = [{ day: '2026-11-10', usdPerEur: '2' }];
    expect(toEurCents(1_000_000, '2026-11-10', two)).toBe(50);
    expect(toEurCents(10_000, '2026-11-10', two)).toBe(1);
    expect(toEurCents(9_999, '2026-11-10', two)).toBe(0);
  });

  it('is exact on amounts a float would round wrong', () => {
    // 0.0105 $ at 1 USD per EUR = 1.05 cent → 1; 0.0115 $ = 1.15 → 1; 0.0125 $ = 1.25 → 1... and 0.015 $ = 1.5 → 2.
    const one = [{ day: '2026-11-10', usdPerEur: '1' }];
    expect(toEurCents(15_000, '2026-11-10', one)).toBe(2);
    expect(toEurCents(14_999, '2026-11-10', one)).toBe(1);
    expect(toEurCents(0, '2026-11-10', one)).toBe(0);
  });

  it('uses the last known rate on a day without one', () => {
    expect(toEurCents(23_418_720, '2026-11-11', RATES)).toBe(2160);
  });

  it('is null while no rate is known for the day or before it', () => {
    expect(toEurCents(23_418_720, '2026-11-01', RATES)).toBeNull();
  });
});

const ECB = `<?xml version="1.0" encoding="UTF-8"?>
<gesmes:Envelope xmlns:gesmes="http://www.gesmes.org/xml/2002-08-01" xmlns="http://www.ecb.int/vocabulary/2002-08-01/eurofxref">
	<gesmes:subject>Reference rates</gesmes:subject>
	<gesmes:Sender><gesmes:name>European Central Bank</gesmes:name></gesmes:Sender>
	<Cube>
		<Cube time='2026-11-13'>
			<Cube currency='USD' rate='1.0842'/>
			<Cube currency='JPY' rate='163.25'/>
		</Cube>
	</Cube>
</gesmes:Envelope>`;

describe('parseEcbDaily', () => {
  it('reads the day and the USD rate of the ECB’s daily file', () => {
    expect(parseEcbDaily(ECB)).toEqual({ day: '2026-11-13', usdPerEur: '1.0842' });
  });

  it('reads double quotes too', () => {
    expect(parseEcbDaily(ECB.replaceAll("'", '"'))).toEqual({ day: '2026-11-13', usdPerEur: '1.0842' });
  });

  it('refuses a file without a day or without the USD rate', () => {
    expect(() => parseEcbDaily(ECB.replace("time='2026-11-13'", ''))).toThrow(/ECB/);
    expect(() => parseEcbDaily(ECB.replace("currency='USD'", "currency='GBP'"))).toThrow(/USD/);
    expect(() => parseEcbDaily(ECB.replace("rate='1.0842'", "rate='-'"))).toThrow(/USD/);
  });
});
