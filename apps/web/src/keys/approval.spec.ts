import type { ApproveDevice, Device, DeviceApproval, EngineEvent, NewDeviceRequest, PendingDevice, TabRelayServerMessage, VaultKeyWrap } from '@crewdeck/contracts';
import { server } from 'vitest/browser';
import { type ApprovalApi, approveDeviceProof, createDeviceApproval, deviceCodeText, deviceCodeUri, newDeviceProof, parseDeviceCode } from './approval.js';
import { type Bytes, fromBase64Url, toBase64Url, utf8 } from './bytes.js';
import { createSessionRelay } from '../sessions/relay.js';
import { INFO, aesGcmSeal, generateKeyPair, importAesKey, openWrap, publicKeyOf, sealWrap } from './crypto.js';
import { memoryDeviceStore, x25519FromPrivateKey } from './testing.js';
import { createVault } from './vault.js';

const fixtures = '../../packages/contracts/fixtures/crypto/';

interface ItemVectors {
  vault: { deviceId: string; vaultKeyVersion: number; devicePrivateKey: string; wrap: { enc: string; ciphertext: string; tag: string } };
}

const NEW_ID = '01933b6e-8f3a-7c4d-9e2f-0a1b2c3d4e5f';
const SHORT_ID = '7K2Q';
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

/**
 * The server, in memory: it keeps what the two pages send it and hands it
 * back, unless a test makes it lie (`tamper`).
 */
const fakeServer = () => {
  const sent: unknown[] = [];
  let pending: PendingDevice | null = null;
  let approval: DeviceApproval | null = null;
  let wrap: VaultKeyWrap | null = null;
  const tamper: { pending?: (device: PendingDevice) => PendingDevice; approval?: (approval: DeviceApproval) => DeviceApproval } = {};
  const api: ApprovalApi = {
    async register(request: NewDeviceRequest) {
      sent.push(request);
      pending = { id: NEW_ID, shortId: SHORT_ID, name: request.name, publicKey: request.publicKey, proof: request.proof, expiresAt: '2026-11-11T10:10:00.000Z' };
      return { id: NEW_ID, shortId: SHORT_ID, expiresAt: pending.expiresAt };
    },
    async pending(shortId) {
      sent.push(shortId);
      if (!pending || pending.shortId !== shortId) throw Object.assign(new Error('404'), { code: 'devices.code-unknown' });
      return tamper.pending ? tamper.pending(pending) : pending;
    },
    async approve(id, body: ApproveDevice) {
      sent.push(body);
      const trusted: Device = { id, name: pending?.name ?? '', state: 'trusted', approvedAt: '2026-11-11T10:01:00.000Z', revokedAt: null, lastSeenAt: null, current: false };
      approval = { approver: { type: body.approver.type, id: body.approver.id, publicKey: approverKey }, proof: body.proof, ...(body.runner ? { runner: body.runner } : {}) };
      wrap = { ...body.wrap, vaultKeyVersion: body.vaultKeyVersion };
      return trusted;
    },
    async approval(id) {
      sent.push(id);
      if (!approval) throw Object.assign(new Error('404'), { code: 'devices.not-found' });
      return tamper.approval ? tamper.approval(approval) : approval;
    },
  };
  // The server stores the trusted Appareil's key, set by the test.
  let approverKey = '';
  return {
    api,
    sent,
    tamper,
    knowApprover: (publicKey: string) => (approverKey = publicKey),
    wrap: () => wrap,
  };
};

/** The trusted Appareil: the Runner's vault of the fixtures, unlocked. */
const trustedSide = async (api: ApprovalApi, runnerPublicKey?: Bytes) => {
  const { vault: vectors } = JSON.parse(await server.commands.readFile(fixtures + 'item.json')) as ItemVectors;
  const { privateKey, publicKey } = await x25519FromPrivateKey(fromBase64Url(vectors.devicePrivateKey));
  const devices = memoryDeviceStore({ deviceId: vectors.deviceId, privateKey, publicKey, ...(runnerPublicKey ? { runnerPublicKey } : {}) });
  const vault = createVault({ devices, fetchWrap: async () => ({ ...vectors.wrap, vaultKeyVersion: vectors.vaultKeyVersion }) });
  await vault.unlockVault();
  return { devices, vault, keys: createDeviceApproval({ devices, vault, api, userAgent: UA }), publicKey: toBase64Url(publicKey), deviceId: vectors.deviceId };
};

/** The new page: no Appareil yet. */
const newSide = (api: ApprovalApi, wrap: () => VaultKeyWrap | null) => {
  const devices = memoryDeviceStore();
  const named: string[] = [];
  const vault = createVault({
    devices,
    fetchWrap: async () => {
      const held = wrap();
      if (!held) throw Object.assign(new Error('404'), { code: 'devices.not-found' });
      return held;
    },
  });
  return { devices, vault, named, keys: createDeviceApproval({ devices, vault, api, userAgent: UA, onDevice: (id) => named.push(id) }) };
};

const setUp = async ({ runnerPublicKey }: { runnerPublicKey?: Bytes } = {}) => {
  const fake = fakeServer();
  const trusted = await trustedSide(fake.api, runnerPublicKey);
  fake.knowApprover(trusted.publicKey);
  const fresh = newSide(fake.api, fake.wrap);
  return { fake, trusted, fresh };
};

/** The new page registers, the trusted one checks and approves its code. */
const approveFresh = async (trusted: Awaited<ReturnType<typeof trustedSide>>, fresh: ReturnType<typeof newSide>) => {
  const code = await fresh.keys.register();
  const typed = parseDeviceCode(deviceCodeUri(code));
  if (!typed) throw new Error('the code does not parse');
  const checked = await trusted.keys.check(typed);
  if (checked === 'mismatch') throw new Error('mismatch');
  await trusted.keys.approve(checked);
  return code;
};

describe('a new Appareil approved by its code', () => {
  it('opens on the new Appareil what the trusted one sealed', async () => {
    const { fake, trusted, fresh } = await setUp();
    const sealed = await trusted.vault.sealItem(utf8('Le texte de mon Idée'), utf8('idea_01J9ZQ4C:text'));

    const code = await fresh.keys.register();
    expect(code).toMatchObject({ id: NEW_ID, shortId: SHORT_ID });
    expect(fresh.devices.current()?.deviceId).toBeNull();

    const typed = parseDeviceCode(deviceCodeUri(code));
    if (!typed) throw new Error('the code does not parse');
    const checked = await trusted.keys.check(typed);
    if (checked === 'mismatch') throw new Error('mismatch');
    expect(checked.device.name).toBe('Safari sur iOS');
    await trusted.keys.approve(checked);

    expect(await fresh.keys.adopt(code)).toBe('approved');
    expect(fresh.named).toEqual([NEW_ID]);
    expect(fresh.devices.current()?.deviceId).toBe(NEW_ID);
    expect(await fresh.vault.unlockVault()).toBe('unlocked');
    expect(new TextDecoder().decode(await fresh.vault.openItem(sealed, utf8('idea_01J9ZQ4C:text')))).toBe('Le texte de mon Idée');

    // The secret never reached the server, in any call.
    for (const body of fake.sent) expect(JSON.stringify(body)).not.toContain(code.secret);
  });

  it('keeps the Runner’s key for the Sessions when the Runner approved it', async () => {
    const { fake, trusted, fresh } = await setUp();
    const code = await approveFresh(trusted, fresh);
    fake.tamper.approval = (approval) => ({ ...approval, approver: { ...approval.approver, type: 'runner' } });

    expect(await fresh.keys.adopt(code)).toBe('approved');
    expect(fresh.devices.current()?.runnerPublicKey).toEqual(fromBase64Url(trusted.publicKey));
    expect(fresh.devices.current()?.senderPublicKey).toEqual(fromBase64Url(trusted.publicKey));
  });

  it('hands the new Appareil the Runner’s key the trusted one authenticated: it opens a Session’s keys and frames', async () => {
    const runner = await generateKeyPair();
    const runnerPublicKey = await publicKeyOf(runner.privateKey);
    const { fake, trusted, fresh } = await setUp({ runnerPublicKey });
    const code = await approveFresh(trusted, fresh);
    expect(await fresh.keys.adopt(code)).toBe('approved');
    const device = fresh.devices.current();
    expect(device?.runnerPublicKey).toEqual(runnerPublicKey);

    // The Runner, holding the new Appareil's key, wraps a Session's key for it.
    const sessionId = '01933b6e-8f3a-7c4d-9e2f-0a1b2c3d4e60';
    const holderId = toBase64Url(device?.publicKey ?? new Uint8Array());
    const raw = crypto.getRandomValues(new Uint8Array(32));
    const wrap = await sealWrap(runner.privateKey, device?.publicKey ?? new Uint8Array(), raw, INFO.sessionKey, utf8(`${sessionId}:${holderId}`));
    const event: EngineEvent = { kind: 'message', seq: 1, at: '2026-11-16T09:00:05.000Z', from: 'agent', text: 'Bonjour', final: false };
    const sealed = await aesGcmSeal(await importAesKey(raw), utf8(JSON.stringify(event)), utf8(`${sessionId}:1`));
    const listeners = new Set<(message: TabRelayServerMessage) => void>();
    const relay = createSessionRelay({
      socket: { sendRelay: () => true, onRelay: (listener) => (listeners.add(listener), () => listeners.delete(listener)), onOpen: () => () => undefined },
      devices: fresh.devices,
      warn: (message) => {
        throw new Error(message);
      },
    });
    const followed = relay.openSession(sessionId);
    const receive = (message: TabRelayServerMessage) => {
      for (const listener of listeners) listener(message);
    };
    receive({ type: 'session.keys', sessionId, wraps: [{ holderId, enc: toBase64Url(wrap.enc), wrappedKey: toBase64Url(wrap.ciphertext), tag: toBase64Url(wrap.tag) }] });
    receive({ type: 'relay', sessionId, seq: 1, nonce: toBase64Url(sealed.subarray(0, 12)), ciphertext: toBase64Url(sealed.subarray(12)) });
    await vi.waitFor(() => expect(followed.events()).toEqual([event]));

    // The Runner learns the new Appareil from the trusted one: a wrap of its key only the Runner opens.
    const body = fake.sent.find((sent): sent is ApproveDevice => typeof sent === 'object' && sent !== null && 'wrap' in sent);
    if (!body?.holder) throw new Error('no holder wrap for the Runner');
    const opened = await openWrap(
      runner.privateKey,
      fromBase64Url(trusted.publicKey),
      { enc: fromBase64Url(body.holder.enc), ciphertext: fromBase64Url(body.holder.ciphertext), tag: fromBase64Url(body.holder.tag) },
      INFO.deviceHolder,
      utf8(NEW_ID),
    );
    expect(opened).toEqual(device?.publicKey);
  });

  it('refuses a Runner’s key the server swapped, and keeps nothing', async () => {
    const runner = await generateKeyPair();
    const other = await generateKeyPair();
    const { fake, trusted, fresh } = await setUp({ runnerPublicKey: await publicKeyOf(runner.privateKey) });
    const code = await approveFresh(trusted, fresh);
    const swapped = toBase64Url(await publicKeyOf(other.privateKey));
    fake.tamper.approval = (approval) => ({ ...approval, ...(approval.runner ? { runner: { ...approval.runner, publicKey: swapped } } : {}) });

    expect(await fresh.keys.adopt(code)).toBe('invalid');
    expect(fresh.devices.current()?.deviceId).toBeNull();
    expect(fresh.devices.current()?.runnerPublicKey).toBeUndefined();
  });

  it('sends no Runner’s key nor holder wrap from an Appareil that has none', async () => {
    const { fake, trusted, fresh } = await setUp();
    const code = await approveFresh(trusted, fresh);
    expect(await fresh.keys.adopt(code)).toBe('approved');
    const body = fake.sent.find((sent): sent is ApproveDevice => typeof sent === 'object' && sent !== null && 'wrap' in sent);
    expect(body).not.toHaveProperty('runner');
    expect(body).not.toHaveProperty('holder');
    expect(fresh.devices.current()?.runnerPublicKey).toBeUndefined();
  });

  it('keeps the key pair of a code not approved yet for the next code', async () => {
    const { fresh } = await setUp();
    await fresh.keys.register();
    const first = fresh.devices.current()?.publicKey;
    await fresh.keys.register();
    expect(fresh.devices.current()?.publicKey).toEqual(first);
  });

  it('approves nothing when the server swaps the new public key', async () => {
    const { fake, trusted, fresh } = await setUp();
    const { privateKey } = await generateKeyPair();
    const theirs = toBase64Url(await publicKeyOf(privateKey));
    fake.tamper.pending = (device) => ({ ...device, publicKey: theirs });

    const code = await fresh.keys.register();
    expect(await trusted.keys.check(code)).toBe('mismatch');
    expect(fake.wrap()).toBeNull();
  });

  it('opens nothing when the server swaps the approver public key', async () => {
    const { fake, trusted, fresh } = await setUp();
    const { privateKey } = await generateKeyPair();
    const theirs = toBase64Url(await publicKeyOf(privateKey));
    const code = await fresh.keys.register();
    const checked = await trusted.keys.check(code);
    if (checked === 'mismatch') throw new Error('mismatch');
    await trusted.keys.approve(checked);
    fake.tamper.approval = (approval) => ({ ...approval, approver: { ...approval.approver, publicKey: theirs } });

    const before = fresh.devices.current();
    expect(await fresh.keys.adopt(code)).toBe('invalid');
    expect(fresh.devices.current()).toEqual(before);
    expect(fresh.named).toEqual([]);
    expect(await fresh.vault.unlockVault()).toBe('no-device');
  });

  it('opens nothing when the proof is not the code’s', async () => {
    const { fake, trusted, fresh } = await setUp();
    const code = await fresh.keys.register();
    const checked = await trusted.keys.check(code);
    if (checked === 'mismatch') throw new Error('mismatch');
    await trusted.keys.approve(checked);
    fake.tamper.approval = (approval) => ({ ...approval, proof: toBase64Url(new Uint8Array(32)) });

    expect(await fresh.keys.adopt(code)).toBe('invalid');
    expect(fresh.devices.current()?.deviceId).toBeNull();
  });

  it('refuses to approve from an Appareil whose vault is locked', async () => {
    const fake = fakeServer();
    const fresh = newSide(fake.api, fake.wrap);
    const code = await fresh.keys.register();
    const other = newSide(fake.api, fake.wrap);
    const checked = await other.keys.check(code);
    if (checked === 'mismatch') throw new Error('mismatch');
    await expect(other.keys.approve(checked)).rejects.toThrow(/holds no vault key/);
    expect(fake.wrap()).toBeNull();
  });
});

describe('the proofs of a new Appareil', () => {
  // The vectors of docs/security/e2e.md « New Appareil », the Runner's too (internal/keys/device_test.go).
  it('are the bytes the Runner computes', async () => {
    const secret = Uint8Array.from({ length: 16 }, (_, i) => i);
    const newKey = new Uint8Array(32).fill(0x11);
    const approverKey = new Uint8Array(32).fill(0x22);
    expect(toBase64Url(await newDeviceProof(secret, newKey))).toBe('NULG3lc4ksC0AGvvSApBzn65aDVMCw9mpjhkRngplZE');
    expect(toBase64Url(await approveDeviceProof(secret, newKey, approverKey))).toBe('txJX8MrtUMCD9-qgPpWAKf61I4PBvdBhEq27LOMt5mE');
  });
});

describe('a device code', () => {
  const secret = 'ABCDEFGHJKMNPQRSTVWXYZ0120';

  it('reads the QR’s text, the code typed with spaces or in lower case', () => {
    const expected = { shortId: '7K2Q', secret };
    expect(parseDeviceCode(`crewdeck:appareil:7K2Q-${secret}`)).toEqual(expected);
    expect(parseDeviceCode(`  7k2q-${secret.toLowerCase()} `)).toEqual(expected);
    expect(parseDeviceCode(`7K2Q - ${secret.slice(0, 13)} ${secret.slice(13)}`)).toEqual(expected);
    expect(deviceCodeText(expected)).toBe(`7K2Q-${secret}`);
  });

  it('is none when it is too short, the wrong alphabet, or another kind of code', () => {
    expect(parseDeviceCode('')).toBeNull();
    expect(parseDeviceCode(`7K2Q-${secret.slice(1)}`)).toBeNull();
    expect(parseDeviceCode(`7KIQ-${secret}`)).toBeNull();
    expect(parseDeviceCode(`7K2Q-${secret.slice(1)}U`)).toBeNull();
    expect(parseDeviceCode(`crewdeck:runner:7K2Q-${secret}`)).toBeNull();
  });
});
