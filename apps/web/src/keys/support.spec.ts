import { supportsEndToEnd } from './support.js';

describe('end-to-end support', () => {
  it('is there in Chromium', async () => {
    expect(await supportsEndToEnd()).toBe(true);
  });

  it('is not there when WebCrypto has no X25519', async () => {
    const withoutX25519 = {
      generateKey: () => Promise.reject(new DOMException('Unrecognized name', 'NotSupportedError')),
    } as unknown as SubtleCrypto;
    expect(await supportsEndToEnd({ subtle: withoutX25519 })).toBe(false);
  });

  it('is not there without WebCrypto (an insecure context)', async () => {
    expect(await supportsEndToEnd({ subtle: null })).toBe(false);
  });
});
