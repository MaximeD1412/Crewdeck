import { vaultWrapAad, zBrowserPairing, zBytes32, zRunnerPairing, zVaultKeyWrap, zWrap } from '../index.js';

const KEY = 'Yfery35HM-eYbPAm7LdhTYCeN5erL97LmNKhUPk930U';

describe('the pairing schemas', () => {
  it('take 32-byte keys and proofs in base64url without padding', () => {
    expect(zBytes32.parse(KEY)).toBe(KEY);
    for (const bad of [`${KEY}=`, KEY.slice(0, 42), `${KEY}AA`, KEY.replace('-', '+')]) expect(zBytes32.safeParse(bad).success, bad).toBe(false);
    expect(zRunnerPairing.parse({ runnerPublicKey: KEY, proof: KEY })).toEqual({ runnerPublicKey: KEY, proof: KEY });
  });

  it('name an Appareil in 1 to 60 characters', () => {
    expect(zBrowserPairing.parse({ devicePublicKey: KEY, deviceName: 'Chrome sur Windows' }).deviceName).toBe('Chrome sur Windows');
    expect(zBrowserPairing.safeParse({ devicePublicKey: KEY, deviceName: 'x'.repeat(61) }).success).toBe(false);
    expect(zBrowserPairing.safeParse({ devicePublicKey: KEY, deviceName: ' ' }).success).toBe(false);
  });

  it('carry a wrap as enc, ciphertext and tag, with its vault key version', () => {
    const wrap = { enc: KEY, ciphertext: 'A'.repeat(64), tag: KEY };
    expect(zWrap.parse(wrap)).toEqual(wrap);
    expect(zWrap.safeParse({ enc: KEY, ciphertext: 'A'.repeat(64) }).success).toBe(false);
    expect(zVaultKeyWrap.parse({ ...wrap, vaultKeyVersion: 2 })).toMatchObject({ vaultKeyVersion: 2 });
  });

  it('bind a vault wrap to its holder and version', () => {
    expect(vaultWrapAad('019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6a01', 1)).toBe('019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6a01:1');
  });
});
