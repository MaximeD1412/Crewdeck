import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { base32, deviceProof, generatePrivateKey, hpkeSeal, publicKeyOf, sealWrap, wrapTag } from './smoke-keys.js';

const FIXTURES = join(import.meta.dirname, '../../../../packages/contracts/fixtures/crypto');
const read = <T>(name: string): T => JSON.parse(readFileSync(join(FIXTURES, name), 'utf8')) as T;
const hex = (text: string): Buffer => Buffer.from(text, 'hex');
const b64 = (text: string): Buffer => Buffer.from(text, 'base64url');

interface Rfc9180 {
  info: string;
  pkRm: string;
  skEm: string;
  enc: string;
  aad: string;
  pt: string;
  ct: string;
}
interface WrapCase {
  name: string;
  recipientPublicKey: string;
  senderPrivateKey: string;
  senderPublicKey: string;
  info: string;
  aad: string;
  enc: string;
  ciphertext: string;
  tag: string;
}

describe('the keys of the scenario smoke', () => {
  it('seal as RFC 9180 base mode does', () => {
    const vector = read<Rfc9180>('hpke-rfc9180.json');
    const sealed = hpkeSeal(hex(vector.pkRm), hex(vector.pt), hex(vector.info), hex(vector.aad), hex(vector.skEm));
    expect(sealed.enc.toString('hex')).toBe(vector.enc);
    expect(sealed.ciphertext.toString('hex')).toBe(vector.ct);
  });

  it('tag a wrap as the page and the Runner do', () => {
    for (const vector of read<{ cases: WrapCase[] }>('crewdeck-wrap.json').cases) {
      expect(publicKeyOf(b64(vector.senderPrivateKey)).toString('base64url'), vector.name).toBe(vector.senderPublicKey);
      const tag = wrapTag(b64(vector.senderPrivateKey), b64(vector.recipientPublicKey), { enc: b64(vector.enc), ciphertext: b64(vector.ciphertext) }, Buffer.from(vector.info), b64(vector.aad));
      expect(tag.toString('base64url'), vector.name).toBe(vector.tag);
    }
  });

  it('give a wrap each seal a new ephemeral key for', () => {
    const sender = generatePrivateKey();
    const recipient = publicKeyOf(generatePrivateKey());
    const first = sealWrap(sender, recipient, Buffer.alloc(32, 7), 'crewdeck/v1/vault-wrap', 'runner:1');
    const second = sealWrap(sender, recipient, Buffer.alloc(32, 7), 'crewdeck/v1/vault-wrap', 'runner:1');
    expect(first.enc).not.toBe(second.enc);
    expect(b64(first.ciphertext)).toHaveLength(48);
    expect(b64(first.tag)).toHaveLength(32);
  });

  it('write the secret in Crockford base32', () => {
    for (const vector of read<{ encode: { bytes: string; text: string }[] }>('base32.json').encode) {
      expect(base32(b64(vector.bytes)), vector.text).toBe(vector.text);
    }
  });

  it('prove the device side of a link', () => {
    const secret = Buffer.alloc(16, 1);
    const proof = deviceProof(secret, '7KQ4', Buffer.alloc(32, 2), Buffer.alloc(32, 3));
    expect(b64(proof)).toHaveLength(32);
    expect(proof).not.toBe(deviceProof(secret, '7KQ5', Buffer.alloc(32, 2), Buffer.alloc(32, 3)));
  });
});

