/** Where the ECB's daily reference rates come from: the real file, or the fake of the tests (`src/testing/fake-fx.ts`). */
export interface FxSource {
  /** The XML of `eurofxref-daily.xml`; throws when it cannot be read. */
  daily(): Promise<string>;
}

/** The token of the `FxSource`: `EcbFxSource` without the fakes, the fake with `CREWDECK_FAKES=1`. */
export const FX_SOURCE = Symbol('FX_SOURCE');

/** The ECB's euro foreign exchange reference rates of the last working day, published around 16:00 CET. */
export const ECB_DAILY_URL = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml';

const TIMEOUT_MS = 10_000;

/** The ECB's file over HTTPS: the server's one call to the ECB (RUNNER-13). */
export class EcbFxSource implements FxSource {
  async daily(): Promise<string> {
    const res = await fetch(ECB_DAILY_URL, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) throw new Error(`The ECB answered ${res.status}.`);
    return res.text();
  }
}

/** In the tests without the fakes: no call to the ECB, ever (AGENTS.md). */
export class NoFxSource implements FxSource {
  daily(): Promise<string> {
    return Promise.reject(new Error('No ECB file in the tests without the fakes.'));
  }
}
