import { PAIRING_PROOF_LABELS, vaultWrapAad, zConfirmPairing, type ConfirmPairing, type Wrap } from '@crewdeck/contracts';
import { server } from 'vitest/browser';
import { encodeBase32 } from './base32.js';
import { type Bytes, fromBase64Url, toBase64Url, utf8 } from './bytes.js';
import { INFO, openWrap } from './crypto.js';
import { createLinkKeys, deviceNameOf, pairingProof } from './pairing.js';
import { memoryDeviceStore, withDeterministicRandom, x25519FromPrivateKey } from './testing.js';
import { createVault } from './vault.js';

const fixtures = '../../packages/contracts/fixtures/crypto/';

interface PairingCase {
  name: string;
  seed: string;
  code: string;
  shortId: string;
  secret: string;
  runnerPrivateKey: string;
  runnerPublicKey: string;
  devicePrivateKey: string;
  devicePublicKey: string;
  runnerProof: string;
  deviceProof: string;
}

// Written by the Runner (internal/keys/generate_test.go).
const pairingCase = async (name: string): Promise<PairingCase> => {
  const file = JSON.parse(await server.commands.readFile(fixtures + 'link-pairing.json')) as { cases: PairingCase[] };
  const found = file.cases.find((c) => c.name === name);
  if (!found) throw new Error(`no case ${name}`);
  return found;
};

const DEVICE_ID = 'dev_01J9ZQ3M';
const RUNNER_ID = 'run_01J9ZQ5R';
const lockedVault = { state: () => 'locked' as const, version: () => null, rawVaultKeyForWrap: () => Promise.reject(new Error('locked')) };

const wire = (wrap: Wrap) => ({ enc: fromBase64Url(wrap.enc), ciphertext: fromBase64Url(wrap.ciphertext), tag: fromBase64Url(wrap.tag) });

/** This browser holds the case's device key, already named by the server. */
const setUp = async (c: PairingCase, vault: Parameters<typeof createLinkKeys>[0]['vault'] = lockedVault) => {
  const device = await x25519FromPrivateKey(fromBase64Url(c.devicePrivateKey));
  const runner = await x25519FromPrivateKey(fromBase64Url(c.runnerPrivateKey));
  const devices = memoryDeviceStore({ deviceId: DEVICE_ID, privateKey: device.privateKey, publicKey: device.publicKey });
  const keys = createLinkKeys({ devices, vault, userAgent: '' });
  const link = {
    secret: encodeBase32(fromBase64Url(c.secret)),
    shortId: c.shortId,
    runnerId: RUNNER_ID,
    runnerPairing: { runnerPublicKey: c.runnerPublicKey, proof: c.runnerProof },
  };
  return { device, runner, devices, keys, link };
};

const openFor = (holder: CryptoKey, sender: Uint8Array, wrap: Wrap, holderId: string, version: number): Promise<Bytes> =>
  openWrap(holder, sender, wire(wrap), INFO.vaultWrap, utf8(vaultWrapAad(holderId, version)));

describe('the Appareil’s name', () => {
  it.each([
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36', 'Chrome sur Windows'],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0', 'Edge sur Windows'],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15', 'Safari sur macOS'],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1', 'Safari sur iOS'],
    ['Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0', 'Firefox sur Linux'],
    ['Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36', 'Chrome sur Android'],
    ['curl/8.0', 'Navigateur sur un autre système'],
  ])('%s is « %s »', (userAgent, name) => {
    expect(deviceNameOf(userAgent)).toBe(name);
  });
});

describe('the pairing', () => {
  it('proves the same bytes as the Runner, both ways', async () => {
    const c = await pairingCase('first-appareil');
    const secret = fromBase64Url(c.secret);
    const [runner, device] = [fromBase64Url(c.runnerPublicKey), fromBase64Url(c.devicePublicKey)];
    expect(toBase64Url(await pairingProof(PAIRING_PROOF_LABELS.runner, secret, c.shortId, runner, device))).toBe(c.runnerProof);
    expect(toBase64Url(await pairingProof(PAIRING_PROOF_LABELS.device, secret, c.shortId, device, runner))).toBe(c.deviceProof);
    expect(`${c.shortId}-${encodeBase32(secret)}`).toBe(c.code);
  });

  it('sends this Appareil’s public key and name with the code', async () => {
    const devices = memoryDeviceStore();
    const named: string[] = [];
    const keys = createLinkKeys({
      devices,
      vault: lockedVault,
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0',
      onDevice: (id) => named.push(id),
    });
    const pairing = await keys.browserPairing();
    expect(pairing.deviceName).toBe('Firefox sur Linux');
    expect(fromBase64Url(pairing.devicePublicKey)).toEqual(devices.current()?.publicKey);

    await keys.adoptDevice(DEVICE_ID);
    expect(devices.current()?.deviceId).toBe(DEVICE_ID);
    expect(named).toEqual([DEVICE_ID]);
  });

  it('confirms the first Appareil: its proof, a new vault key wrapped at version 1 for the Runner and for itself', async () => {
    const c = await pairingCase('first-appareil');
    const { keys, link, device, runner } = await setUp(c);

    const confirm = await keys.confirmPairing(link);
    if (!confirm) throw new Error('refused');

    expect(zConfirmPairing.parse(confirm)).toEqual(confirm);
    expect(confirm.proof).toBe(c.deviceProof);
    expect(confirm.vaultKeyVersion).toBe(1);
    if (!confirm.deviceVaultWrap) throw new Error('no device wrap');
    const forRunner = await openFor(runner.privateKey, device.publicKey, confirm.runnerVaultWrap, RUNNER_ID, 1);
    const forDevice = await openFor(device.privateKey, device.publicKey, confirm.deviceVaultWrap, DEVICE_ID, 1);
    expect(forRunner.length).toBe(32);
    expect(forRunner).toEqual(forDevice);
    // Each wrap is bound to its holder.
    await expect(openFor(runner.privateKey, device.publicKey, confirm.runnerVaultWrap, DEVICE_ID, 1)).rejects.toThrow();
  });

  it('draws a new vault key for each first link', async () => {
    const c = await pairingCase('first-appareil');
    const { keys, link, device } = await setUp(c);
    const keyOf = async (confirm: ConfirmPairing | null) => {
      if (!confirm?.deviceVaultWrap) throw new Error('refused');
      return toBase64Url(await openFor(device.privateKey, device.publicKey, confirm.deviceVaultWrap, DEVICE_ID, 1));
    };
    expect(await keyOf(await keys.confirmPairing(link))).not.toBe(await keyOf(await keys.confirmPairing(link)));
  });

  it('refuses a Runner key the server swapped: its proof does not match', async () => {
    const c = await pairingCase('first-appareil');
    const { keys, link } = await setUp(c);
    // The server hands its own key with the Runner's proof…
    const swapped = (await pairingCase('relink')).runnerPublicKey;
    expect(await keys.confirmPairing({ ...link, runnerPairing: { ...link.runnerPairing, runnerPublicKey: swapped } })).toBeNull();
    // …or computes a proof without the secret.
    const forged = toBase64Url(await pairingProof(PAIRING_PROOF_LABELS.runner, new Uint8Array(16), c.shortId, fromBase64Url(swapped), fromBase64Url(c.devicePublicKey)));
    expect(await keys.confirmPairing({ ...link, runnerPairing: { runnerPublicKey: swapped, proof: forged } })).toBeNull();
    // The device proof replayed as the Runner's.
    expect(await keys.confirmPairing({ ...link, runnerPairing: { ...link.runnerPairing, proof: c.deviceProof } })).toBeNull();
  });

  it('never puts the secret nor the vault key in what it sends', async () => {
    const c = await pairingCase('first-appareil');
    const { keys, link, device } = await setUp(c);
    const confirm = await keys.confirmPairing(link);
    if (!confirm?.deviceVaultWrap) throw new Error('refused');
    const vaultKey = await openFor(device.privateKey, device.publicKey, confirm.deviceVaultWrap, DEVICE_ID, 1);

    const sent = JSON.stringify([confirm, await keys.browserPairing()]);
    for (const secret of [link.secret, c.secret, toBase64Url(vaultKey)]) expect(sent).not.toContain(secret);
  });

  it('relinks from an unlocked vault: the same key for the new Runner only, its version unchanged', async () => {
    const c = await pairingCase('relink');
    const held = utf8('the vault key the Appareil holds');
    const given: Bytes[] = [];
    const vault = {
      state: () => 'unlocked' as const,
      version: () => 3,
      rawVaultKeyForWrap: async () => {
        const copy = new Uint8Array(held);
        given.push(copy);
        return copy;
      },
    };
    const { keys, link, device, runner } = await setUp(c, vault);

    const confirm = await keys.confirmPairing(link);
    if (!confirm) throw new Error('refused');

    expect(confirm.proof).toBe(c.deviceProof);
    expect(confirm.vaultKeyVersion).toBe(3);
    expect(confirm).not.toHaveProperty('deviceVaultWrap');
    expect(await openFor(runner.privateKey, device.publicKey, confirm.runnerVaultWrap, RUNNER_ID, 3)).toEqual(held);
    // The bytes the vault handed out are overwritten once sealed.
    expect(given[0]).toEqual(new Uint8Array(32));
  });
});

describe('what the browser paired', () => {
  // The Runner opens this file (TestWhatTheBrowserPairedOpens): the proof, its
  // wrap, and an item the browser sealed with the vault it opened. It is
  // rewritten on every run; the seeds keep it byte-identical.
  it('is written for the Runner to open', async () => {
    const c = await pairingCase('first-appareil');
    const { keys, link, devices } = await setUp(c);
    const pairingSeed = utf8('crewdeck-web/pairing');
    const confirm = await withDeterministicRandom(pairingSeed, () => keys.confirmPairing(link));
    if (!confirm?.deviceVaultWrap) throw new Error('refused');
    const deviceVaultWrap = confirm.deviceVaultWrap;

    const vault = createVault({ devices, fetchWrap: async () => ({ ...deviceVaultWrap, vaultKeyVersion: confirm.vaultKeyVersion }) });
    expect(await vault.unlockVault()).toBe('unlocked');
    const itemSeed = utf8('crewdeck-web/item');
    const aad = utf8('idea_01J9ZQ4C:text');
    const plaintext = utf8('Une Idée scellée dans le navigateur.');
    const item = await withDeterministicRandom(itemSeed, () => vault.sealItem(plaintext, aad));

    const file = {
      description:
        'Written by the browser (apps/web/src/keys/pairing.spec.ts, Chromium WebCrypto) from the « first-appareil » case of link-pairing.json, opened by the Runner. Byte strings are base64url without padding.',
      case: c.name,
      seed: toBase64Url(pairingSeed),
      deviceId: DEVICE_ID,
      runnerId: RUNNER_ID,
      confirm,
      item: {
        seed: toBase64Url(itemSeed),
        aad: toBase64Url(aad),
        plaintext: toBase64Url(plaintext),
        key: toBase64Url(item.key),
        ciphertext: toBase64Url(item.ciphertext),
      },
    };
    await server.commands.writeFile(fixtures + 'web-pairing.json', JSON.stringify(file, null, 2) + '\n');
    expect(JSON.parse(await server.commands.readFile(fixtures + 'web-pairing.json'))).toEqual(file);
  });
});
