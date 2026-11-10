/**
 * Whether this browser can hold end-to-end keys: WebCrypto with X25519
 * (Chrome 133+, Safari 17+, Firefox 130+). There is no fallback; without it
 * the page says so (copy key `keys.unsupported`, « Ce navigateur ne peut pas
 * chiffrer de bout en bout. »).
 */
export const supportsEndToEnd = async ({
  subtle = globalThis.crypto?.subtle,
}: { subtle?: SubtleCrypto | null } = {}): Promise<boolean> => {
  if (!subtle) return false;
  try {
    const pair = (await subtle.generateKey({ name: 'X25519' }, false, ['deriveBits'])) as CryptoKeyPair;
    await subtle.deriveBits({ name: 'X25519', public: pair.publicKey }, pair.privateKey, 256);
    return true;
  } catch {
    return false;
  }
};
