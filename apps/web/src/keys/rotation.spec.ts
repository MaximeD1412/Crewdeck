import { type RotationWrap, type Vault as ServerVault, type VaultItem, type VaultItems, type VaultKeyWrap, vaultWrapAad } from '@crewdeck/contracts';
import { ApiError } from '../api/request.js';
import { type Bytes, fromBase64Url, toBase64Url, utf8 } from './bytes.js';
import { INFO, generateKeyPair, openWrap, publicKeyOf, sealWrap } from './crypto.js';
import type { StoredDevice } from './device-store.js';
import { createVaultRotation, type RotationApi } from './rotation.js';
import { memoryDeviceStore } from './testing.js';
import { createVault } from './vault.js';

const SELF_ID = '019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6a01';
const RUNNER_ID = '019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6a02';
const APPROVER_ID = '019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6a03';
const itemId = (n: number) => `019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6b${String(n).padStart(2, '0')}`;
/** A kind of item registered for the test only. */
const ITEM_TYPE = 'test.item';

const holderKey = async () => {
  const { privateKey } = await generateKeyPair();
  return { privateKey, publicKey: await publicKeyOf(privateKey) };
};
type HolderKey = Awaited<ReturnType<typeof holderKey>>;

const toWire = (wrap: { enc: Bytes; ciphertext: Bytes; tag: Bytes }) => ({ enc: toBase64Url(wrap.enc), ciphertext: toBase64Url(wrap.ciphertext), tag: toBase64Url(wrap.tag) });
const fromWire = (wrap: { enc: string; ciphertext: string; tag: string }) => ({ enc: fromBase64Url(wrap.enc), ciphertext: fromBase64Url(wrap.ciphertext), tag: fromBase64Url(wrap.tag) });
const refused = (status: number, code: string) => new ApiError({ status, code, message: code });

/**
 * The server, in memory: the vault at version 1, its holders, their wraps and
 * the item keys; it takes a rotation as the real one does (`seq`, the version,
 * every holder and every item exactly once) and hands the new wraps back.
 */
const fakeServer = (holders: ServerVault['holders']) => {
  const state = { version: 1, rotationPending: true, seq: 10, holders };
  const wraps = new Map<string, VaultKeyWrap>();
  const items = new Map<string, VaultItem>();
  const posted: unknown[] = [];
  const reads = { vault: 0, items: 0 };
  /** Called before each rotation is checked: what happens meanwhile (another holder, a new item). */
  let meanwhile: (() => void | Promise<void>) | null = null;
  const api: RotationApi = {
    async vault() {
      reads.vault++;
      return structuredClone(state);
    },
    async items(cursor): Promise<VaultItems> {
      reads.items++;
      // Two per page, to read every page.
      const all = [...items.values()];
      const start = cursor === null ? 0 : Number(cursor);
      const page = all.slice(start, start + 2);
      return { items: page, nextCursor: start + 2 < all.length ? String(start + 2) : null };
    },
    async rotate(body) {
      posted.push(body);
      await meanwhile?.();
      if (body.fromVersion !== state.version) throw refused(409, 'vault.version-changed');
      if (body.seq !== state.seq) throw refused(409, 'realtime.stale');
      const named = body.wraps.map((wrap: RotationWrap) => `${wrap.holderType}:${wrap.holderId}`).sort();
      if (named.join() !== state.holders.map((holder) => `${holder.type}:${holder.id}`).sort().join()) throw refused(422, 'vault.holders-missing');
      if (body.items.map((item) => item.itemId).sort().join() !== [...items.keys()].sort().join()) throw refused(422, 'vault.items-missing');
      if (body.items.some((item) => items.get(item.itemId)?.wrappedKey !== item.previousKey)) throw refused(409, 'vault.items-changed');
      for (const wrap of body.wraps) wraps.set(wrap.holderId, { enc: wrap.enc, ciphertext: wrap.ciphertext, tag: wrap.tag, vaultKeyVersion: body.toVersion });
      for (const item of body.items) items.set(item.itemId, { ...(items.get(item.itemId) as VaultItem), wrappedKey: item.wrappedKey });
      state.version = body.toVersion;
      state.rotationPending = false;
      state.seq++;
    },
  };
  return {
    api,
    state,
    wraps,
    items,
    posted,
    reads,
    meanwhile: (fn: (() => void | Promise<void>) | null) => (meanwhile = fn),
    fetchWrap: async (deviceId: string) => {
      const wrap = wraps.get(deviceId);
      if (!wrap || wrap.vaultKeyVersion !== state.version) throw refused(404, 'devices.not-found');
      return wrap;
    },
  };
};

/**
 * This Appareil, approved by another one (its wrap of version 1 sealed by the
 * approver), with the Runner's key from its approval; the vault unlocked, and
 * three items sealed under version 1.
 */
const setUp = async ({ withApprover = false, stored = {} as Partial<StoredDevice> } = {}) => {
  const self = await holderKey();
  const runner = await holderKey();
  const approver = await holderKey();
  const holders: ServerVault['holders'] = [
    { type: 'device', id: SELF_ID, publicKey: toBase64Url(self.publicKey) },
    { type: 'runner', id: RUNNER_ID, publicKey: toBase64Url(runner.publicKey) },
    ...(withApprover ? [{ type: 'device' as const, id: APPROVER_ID, publicKey: toBase64Url(approver.publicKey) }] : []),
  ];
  const fake = fakeServer(holders);
  const oldKey = crypto.getRandomValues(new Uint8Array(32));
  fake.wraps.set(SELF_ID, { ...toWire(await sealWrap(approver.privateKey, self.publicKey, oldKey, INFO.vaultWrap, utf8(vaultWrapAad(SELF_ID, 1)))), vaultKeyVersion: 1 });
  const devices = memoryDeviceStore({
    deviceId: SELF_ID,
    privateKey: self.privateKey,
    publicKey: self.publicKey,
    senderPublicKey: approver.publicKey,
    runnerPublicKey: runner.publicKey,
    ...stored,
  });
  const vault = createVault({ devices, fetchWrap: fake.fetchWrap });
  expect(await vault.unlockVault()).toBe('unlocked');
  const sealed = new Map<string, { ciphertext: Bytes; aad: Bytes; text: string }>();
  const addItem = async (n: number) => {
    const id = itemId(n);
    const aad = `${id}:text`;
    const text = `Le texte de l’Idée ${n}`;
    const item = await vault.sealItem(utf8(text), utf8(aad));
    fake.items.set(id, { itemType: ITEM_TYPE, itemId: id, aad, wrappedKey: toBase64Url(item.key) });
    sealed.set(id, { ciphertext: item.ciphertext, aad: utf8(aad), text });
  };
  for (const n of [1, 2, 3]) await addItem(n);
  const rotation = createVaultRotation({ devices, vault, api: fake.api });
  return { fake, vault, devices, runner, approver, self, oldKey, sealed, addItem, rotation };
};

/** Every item, by the key the server now holds, opens to its text. */
const expectItemsOpen = async ({ fake, vault, sealed }: Pick<Awaited<ReturnType<typeof setUp>>, 'fake' | 'vault' | 'sealed'>) => {
  expect(sealed.size).toBe(fake.items.size);
  for (const [id, item] of sealed) {
    const key = fromBase64Url(fake.items.get(id)?.wrappedKey ?? '');
    expect(new TextDecoder().decode(await vault.openItem({ key, ciphertext: item.ciphertext }, item.aad))).toBe(item.text);
  }
};

const runnerOpens = (runner: HolderKey, self: HolderKey, wrap: VaultKeyWrap | undefined) =>
  openWrap(runner.privateKey, self.publicKey, fromWire(wrap ?? { enc: '', ciphertext: '', tag: '' }), INFO.vaultWrap, utf8(vaultWrapAad(RUNNER_ID, 2)));

describe('the rotation of the vault key from a trusted Appareil (E2E-4)', () => {
  it('moves the version, every holder kept opens the new key, and an item sealed before opens after', async () => {
    const { fake, vault, runner, self, oldKey, sealed, rotation } = await setUp();

    expect(await rotation.rotate()).toBe('rotated');

    expect(fake.state).toMatchObject({ version: 2, rotationPending: false });
    expect(fake.posted).toHaveLength(1);
    expect(fake.posted[0]).toMatchObject({ fromVersion: 1, toVersion: 2, seq: 10 });
    // Every page of the items was read.
    expect(fake.reads.items).toBe(2);
    // This Appareil opened its own wrap of version 2 at once.
    expect(vault.version()).toBe(2);
    const newKey = await vault.rawVaultKeyForWrap();
    expect(newKey).not.toEqual(oldKey);
    // The Runner opens its wrap from this Appareil's key, which it holds.
    expect(await runnerOpens(runner, self, fake.wraps.get(RUNNER_ID))).toEqual(newKey);
    await expectItemsOpen({ fake, vault, sealed });
  });

  it('opens its new wrap again from its own key, after a reload', async () => {
    const { fake, devices, rotation } = await setUp();
    expect(await rotation.rotate()).toBe('rotated');
    const reloaded = createVault({ devices, fetchWrap: fake.fetchWrap });
    expect(await reloaded.unlockVault()).toBe('unlocked');
    expect(reloaded.version()).toBe(2);
  });

  it('seals nothing for a key it did not authenticate: a key the server slipped in, or another Appareil it cannot be known by', async () => {
    const slipped = await setUp();
    const theirs = await holderKey();
    slipped.fake.state.holders.push({ type: 'device', id: APPROVER_ID, publicKey: toBase64Url(theirs.publicKey) });
    expect(await slipped.rotation.rotate()).toBe('unknown-holder');
    expect(slipped.fake.posted).toEqual([]);

    // The Runner listed with another key than the one this Appareil authenticated.
    const swapped = await setUp();
    const runner = swapped.fake.state.holders.find((holder) => holder.type === 'runner');
    if (runner) runner.publicKey = toBase64Url(theirs.publicKey);
    expect(await swapped.rotation.rotate()).toBe('unknown-holder');
    expect(swapped.fake.posted).toEqual([]);

    // Its approver kept: it holds no key of this Appareil to open a wrap from, so the Runner rotates.
    const approver = await setUp({ withApprover: true });
    expect(await approver.rotation.rotate()).toBe('unknown-holder');
    expect(approver.fake.posted).toEqual([]);

    // Without the Runner's key, the Runner listed is one it never authenticated.
    const noRunner = await setUp({ stored: { runnerPublicKey: undefined } });
    expect(await noRunner.rotation.rotate()).toBe('unknown-holder');
    expect(noRunner.fake.posted).toEqual([]);
    expect(noRunner.vault.version()).toBe(1);
  });

  it('does not rotate an Appareil the server no longer lists, nor a vault with no rotation pending', async () => {
    const gone = await setUp();
    gone.fake.state.holders.splice(0, 1);
    expect(await gone.rotation.rotate()).toBe('unknown-holder');
    expect(gone.fake.posted).toEqual([]);

    const done = await setUp();
    done.fake.state.rotationPending = false;
    expect(await done.rotation.rotate()).toBe('not-pending');
    expect(done.fake.posted).toEqual([]);
  });

  it('reloads the vault and tries once more when it changed meanwhile, with what it missed', async () => {
    const { fake, vault, sealed, addItem, rotation } = await setUp();
    // An Idée noted while the rotation was drawn: its seq moved, the rotation misses its item.
    let once = true;
    fake.meanwhile(async () => {
      if (!once) return;
      once = false;
      await addItem(4);
      fake.state.seq++;
    });

    expect(await rotation.rotate()).toBe('rotated');
    expect(fake.reads.vault).toBe(2);
    expect(fake.posted).toHaveLength(2);
    expect(fake.posted[1]).toMatchObject({ fromVersion: 1, toVersion: 2, seq: 11 });
    expect(sealed.size).toBe(4);
    await expectItemsOpen({ fake, vault, sealed });
  });

  it('sends each item key it read as previousKey; an item sealed again meanwhile (409 vault.items-changed), it reads the items again and tries once more', async () => {
    const { fake, vault, sealed, addItem, rotation } = await setUp();
    const read = new Map([...fake.items].map(([id, item]) => [id, item.wrappedKey]));
    let once = true;
    fake.meanwhile(async () => {
      if (!once) return;
      once = false;
      // The same Idée's text sealed again, under a new item key: the rotation read the older one.
      await addItem(2);
    });

    expect(await rotation.rotate()).toBe('rotated');
    expect(fake.posted).toHaveLength(2);
    const [first, second] = fake.posted as { items: { itemId: string; previousKey: string }[] }[];
    expect(new Map(first?.items.map(({ itemId: id, previousKey }) => [id, previousKey]))).toEqual(read);
    expect(second?.items.find(({ itemId: id }) => id === itemId(2))?.previousKey).not.toBe(read.get(itemId(2)));
    await expectItemsOpen({ fake, vault, sealed });

    // Changed again on the second try: it stops there.
    const busy = await setUp();
    busy.fake.meanwhile(() => busy.addItem(1));
    expect(await busy.rotation.rotate()).toBe('failed');
    expect(busy.fake.posted).toHaveLength(2);
    expect(busy.vault.version()).toBe(1);
  });

  it('stops once another holder rotated first, and tries once only', async () => {
    const first = await setUp();
    // The Runner rotated between the read and the post.
    first.fake.meanwhile(() => {
      first.fake.state.version = 2;
      first.fake.state.rotationPending = false;
      first.fake.state.seq++;
    });
    expect(await first.rotation.rotate()).toBe('not-pending');
    expect(first.fake.posted).toHaveLength(1);

    const busy = await setUp();
    busy.fake.meanwhile(() => {
      busy.fake.state.seq++;
    });
    expect(await busy.rotation.rotate()).toBe('failed');
    expect(busy.fake.posted).toHaveLength(2);
    expect(busy.vault.version()).toBe(1);
  });

  it('stops on an item key that does not open, and posts nothing', async () => {
    const { fake, rotation } = await setUp();
    const item = fake.items.get(itemId(2));
    if (item) fake.items.set(item.itemId, { ...item, aad: `${itemId(9)}:text` });
    expect(await rotation.rotate()).toBe('failed');
    expect(fake.posted).toEqual([]);
  });

  it('does not rotate from a locked vault', async () => {
    const { fake, devices } = await setUp();
    const locked = createVault({ devices, fetchWrap: fake.fetchWrap });
    expect(await createVaultRotation({ devices, vault: locked, api: fake.api }).rotate()).toBe('locked');
    expect(fake.reads.vault).toBe(0);
  });
});
