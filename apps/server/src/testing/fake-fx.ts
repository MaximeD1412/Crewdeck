import type { FxSource } from '../usage/fx-source.js';
import type { Fake } from './fakes.js';

/** The ECB of the tests and of the scenarios: `xml` is the daily file it serves, none (an error) until a test sets one. */
export class FakeFx implements FxSource, Fake {
  xml: string | null = null;

  daily(): Promise<string> {
    return this.xml === null ? Promise.reject(new Error('The fake ECB has no file.')) : Promise.resolve(this.xml);
  }

  reset(): void {
    this.xml = null;
  }
}
