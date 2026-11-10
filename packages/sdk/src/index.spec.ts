import { version } from './index.js';

describe('the SDK', () => {
  it('exports its version', () => {
    expect(version).toMatch(/^\d+\.\d+\.\d+/);
  });
});
