import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DEFAULT_ACCOUNT_SETTINGS, type ProjectSettings, type SealedItem } from '@crewdeck/contracts';
import { ApiError } from './api/request.js';
import { fromBase64Url, toBase64Url, utf8 } from './keys/bytes.js';
import { memoryDeviceStore, x25519FromPrivateKey } from './keys/testing.js';
import { createVault, type Vault } from './keys/vault.js';
import { createProjectSettings } from './project-settings.js';

const PROJECT = '019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6a01';
const AAD = utf8(`settings:${PROJECT}`);

interface VaultVectors {
  vault: { deviceId: string; vaultKeyVersion: number; devicePrivateKey: string; wrap: { enc: string; ciphertext: string; tag: string } };
}

// The vault the Runner wrote (internal/keys/generate_test.go), unlocked as an Appareil does.
const unlockedVault = async (): Promise<Vault> => {
  const { vault } = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../../packages/contracts/fixtures/crypto/item.json'), 'utf8')) as VaultVectors;
  const { privateKey, publicKey } = await x25519FromPrivateKey(fromBase64Url(vault.devicePrivateKey));
  const created = createVault({
    devices: memoryDeviceStore({ deviceId: vault.deviceId, privateKey, publicKey }),
    fetchWrap: async () => ({ ...vault.wrap, vaultKeyVersion: vault.vaultKeyVersion }),
    onState: () => undefined,
  });
  expect(await created.unlockVault()).toBe('unlocked');
  return created;
};

const settingsOf = (worktreeCommands: SealedItem | null = null): ProjectSettings => ({
  projectId: PROJECT,
  effective: { ...DEFAULT_ACCOUNT_SETTINGS, timeZone: 'Europe/Paris' },
  origins: { roles: { idea: 'compte', design: 'compte', code: 'compte', review: 'compte' }, notifications: { push: 'compte' } },
  changedCount: 0,
  branches: { integration: 'develop', release: 'main' },
  worktreeCommands,
});

/**
 * The page's boundaries: the API, each command recorded and answered with
 * what the server stored and the `seq` of its event once it commits (at once
 * unless the answer commits it), or refused; and the store, which holds the
 * events it was given (`deliver`, `write`) or a snapshot of the server.
 */
const fakeClient = () => {
  const calls: { method: string; path: string; body: Record<string, unknown> }[] = [];
  const commits: number[] = [];
  let seq = 0;
  let current: SealedItem | null = null;
  let answer: (body: Record<string, unknown>, commit: () => void) => Promise<ProjectSettings> = async (body) => settingsOf((body['worktreeCommands'] as SealedItem | null | undefined) ?? null);
  const client = {
    command: vi.fn(async (method: string, path: string, body: object) => {
      const index = calls.push({ method, path, body: body as Record<string, unknown> }) - 1;
      const commit = () => {
        if (commits[index] !== undefined) return;
        commits[index] = ++seq;
        if ('worktreeCommands' in body) current = (body as { worktreeCommands: SealedItem | null }).worktreeCommands;
      };
      const settings = await answer(body as Record<string, unknown>, commit);
      commit();
      return { ...settings, seq: commits[index] };
    }),
  };

  let storeSeq: bigint | null = 0n;
  let inStore: SealedItem | null = null;
  const listeners = new Set<() => void>();
  const tell = () => {
    for (const listener of [...listeners]) listener();
  };
  const store = {
    /** The worktree Commandes the store holds. */
    inStore: () => inStore,
    listeners,
    /** Tells the listeners of an event of something else (another Projet's, the account's). */
    tell,
    /** The event of the call at `index`. */
    deliver(index: number) {
      storeSeq = BigInt(commits[index] as number);
      inStore = calls[index]?.body['worktreeCommands'] as SealedItem | null;
      tell();
    },
    /** Another tab's write, and its event unless it is lost. */
    write(item: SealedItem | null, { event = true } = {}) {
      seq += 1;
      current = item;
      if (!event) return;
      storeSeq = BigInt(seq);
      inStore = item;
      tell();
    },
    /** A resynchronisation: the server's state and `seq`, the events it covers never given. */
    snapshot() {
      storeSeq = BigInt(seq);
      inStore = current;
      tell();
    },
  };
  const ownStore = {
    seq: () => storeSeq,
    subscribe: (fn: () => void) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
  return { client: client as never, stored: ownStore, store, calls, answer: (next: typeof answer) => (answer = next) };
};

const refusal = (fields?: Record<string, string>) =>
  new ApiError({ status: 422, code: 'validation.failed', message: 'Vérifie les champs signalés.', ...(fields ? { fields } : {}) });

const PATH = `/api/projects/${PROJECT}/settings`;

/** Waits for the notifications of a promise the module started on its own (opening an item). */
const notified = (settings: ReturnType<typeof createProjectSettings>) => new Promise<void>((resolve) => {
  const stop = settings.subscribe(() => {
    stop();
    resolve();
  });
});

describe('createProjectSettings, the Rôles, the branches, push', () => {
  it('stores a Rôle’s Moteur and model, push, a branch trimmed, each as its own patch of the Projet', async () => {
    const { client, stored, calls } = fakeClient();
    const settings = createProjectSettings({ client, stored });

    await settings.change(PROJECT, 'role:code', 'codex:gpt-5.5');
    await settings.change(PROJECT, 'role:r-k3v9q2m7', 'claude-code:claude-opus-5-5');
    await settings.change(PROJECT, 'push', false);
    await settings.change(PROJECT, 'branch:integration', '  dev  ');
    expect(calls).toEqual([
      { method: 'PATCH', path: PATH, body: { roles: { code: { engine: 'codex', model: 'gpt-5.5' } } } },
      { method: 'PATCH', path: PATH, body: { roles: { 'r-k3v9q2m7': { engine: 'claude-code', model: 'claude-opus-5-5' } } } },
      { method: 'PATCH', path: PATH, body: { notifications: { push: false } } },
      { method: 'PATCH', path: PATH, body: { branches: { integration: 'dev' } } },
    ]);
  });

  it('sends a Rôle and push back to the account’s', async () => {
    const { client, stored, calls } = fakeClient();
    const settings = createProjectSettings({ client, stored });

    await settings.revert(PROJECT, 'role:review');
    await settings.revert(PROJECT, 'push');
    await settings.revert(PROJECT, 'branch:release');
    expect(calls.map((call) => call.body)).toEqual([{ roles: { review: null } }, { notifications: { push: null } }]);
  });

  it('ignores a control it does not know, and a value of the wrong kind', async () => {
    const { client, stored, calls } = fakeClient();
    const settings = createProjectSettings({ client, stored });

    await settings.change(PROJECT, 'unknown', true);
    await settings.change(PROJECT, 'push', 'on');
    await settings.change(PROJECT, 'role:code', 'no-model');
    await settings.change(PROJECT, 'branch:other', 'x');
    expect(calls).toEqual([]);
  });

  it('keeps a branch typed while it is on its way and once refused, the refusal on its field; drops both once stored', async () => {
    const { client, stored, answer } = fakeClient();
    const settings = createProjectSettings({ client, stored });
    answer(async () => {
      expect(settings.view(PROJECT, null, 'locked').drafts).toEqual({ 'branch:release': 'prod..x' });
      throw refusal({ 'branches.release': 'Ce nom de branche n’est pas valide.' });
    });

    await settings.change(PROJECT, 'branch:release', 'prod..x');
    expect(settings.view(PROJECT, null, 'locked')).toMatchObject({ drafts: { 'branch:release': 'prod..x' }, errors: { 'branch:release': 'Ce nom de branche n’est pas valide.' } });

    answer(async () => settingsOf());
    await settings.change(PROJECT, 'branch:release', 'prod');
    expect(settings.view(PROJECT, null, 'locked')).toMatchObject({ drafts: {}, errors: {} });
  });

  it('puts a refusal without a field’s message on the control, by its message', async () => {
    const { client, stored, answer } = fakeClient();
    const settings = createProjectSettings({ client, stored });
    answer(async () => {
      throw refusal();
    });

    await settings.change(PROJECT, 'role:code', 'codex:gpt-5.5');
    expect(settings.view(PROJECT, null, 'locked').errors).toEqual({ 'role:code': 'Vérifie les champs signalés.' });
  });

  it('sends a Projet’s changes one after the other, in the order given', async () => {
    const { client, stored, calls, answer } = fakeClient();
    const settings = createProjectSettings({ client, stored });
    let release: () => void = () => undefined;
    answer(() => new Promise((resolve) => (release = () => resolve(settingsOf()))));

    const first = settings.change(PROJECT, 'branch:integration', 'a');
    const second = settings.change(PROJECT, 'branch:integration', 'b');
    await Promise.resolve();
    expect(calls).toHaveLength(1);
    answer(async () => settingsOf());
    release();
    await Promise.all([first, second]);
    expect(calls.map((call) => call.body)).toEqual([{ branches: { integration: 'a' } }, { branches: { integration: 'b' } }]);
  });
});

describe('createProjectSettings, the worktree Commandes', () => {
  const sealer = (vault: Vault) => ({
    seal: async (commands: object): Promise<SealedItem> => {
      const item = await vault.sealItem(utf8(JSON.stringify(commands)), AAD);
      return { key: toBase64Url(item.key), ciphertext: toBase64Url(item.ciphertext) };
    },
    decoded: async (item: SealedItem) =>
      JSON.parse(new TextDecoder().decode(await vault.openItem({ key: fromBase64Url(item.key), ciphertext: fromBase64Url(item.ciphertext) }, AAD))) as unknown,
  });

  it('keeps them locked, and sends nothing, while the vault is locked or the browser has none', async () => {
    const { client, stored, calls } = fakeClient();
    const vault = await unlockedVault();
    expect(createProjectSettings({ client, vault, stored }).view(PROJECT, null, 'locked').worktree).toEqual({ state: 'locked' });
    expect(createProjectSettings({ client, vault, stored }).view(PROJECT, null, 'no-device').worktree).toEqual({ state: 'locked' });
    const without = createProjectSettings({ client, stored });
    expect(without.view(PROJECT, null, 'unlocked').worktree).toEqual({ state: 'locked' });

    await without.change(PROJECT, 'worktree:prepare', 'pnpm install');
    expect(calls).toEqual([]);
  });

  it('seals both in one item before they leave the page, and opens it again after a reload', async () => {
    const { client, stored, store, calls } = fakeClient();
    const vault = await unlockedVault();
    const settings = createProjectSettings({ client, vault, stored });
    expect(settings.view(PROJECT, null, 'unlocked').worktree).toEqual({ state: 'open', prepare: '', clean: '' });

    await settings.change(PROJECT, 'worktree:prepare', 'pnpm install');
    await settings.change(PROJECT, 'worktree:clean', 'rm -rf .cache');
    expect(JSON.stringify(calls)).not.toMatch(/pnpm|rm -rf/);
    const sent = calls.at(-1)?.body['worktreeCommands'] as SealedItem;
    expect(await sealer(vault).decoded(sent)).toEqual({ prepare: 'pnpm install', clean: 'rm -rf .cache' });
    store.deliver(0);
    store.deliver(1);
    expect(settings.view(PROJECT, store.inStore(), 'unlocked')).toMatchObject({ drafts: {}, worktree: { state: 'open', prepare: 'pnpm install', clean: 'rm -rf .cache' } });

    // A reload: a new page, the same vault, the item the server kept.
    const reloaded = createProjectSettings({ client, vault, stored });
    const opening = notified(reloaded);
    expect(reloaded.view(PROJECT, sent, 'unlocked').worktree).toEqual({ state: 'opening' });
    await opening;
    expect(reloaded.view(PROJECT, sent, 'unlocked').worktree).toEqual({ state: 'open', prepare: 'pnpm install', clean: 'rm -rf .cache' });
  });

  it('removes the item when both are emptied', async () => {
    const { client, stored, calls } = fakeClient();
    const vault = await unlockedVault();
    const settings = createProjectSettings({ client, vault, stored });
    settings.view(PROJECT, null, 'unlocked');

    await settings.change(PROJECT, 'worktree:prepare', 'pnpm install');
    await settings.change(PROJECT, 'worktree:prepare', '   ');
    expect(calls.at(-1)?.body).toEqual({ worktreeCommands: null });
  });

  it('says an item this vault cannot open is unreadable, and replaces it with what the Pilote writes', async () => {
    const { client, stored, calls } = fakeClient();
    const vault = await unlockedVault();
    const other = await vault.sealItem(utf8(JSON.stringify({ prepare: 'x', clean: null })), utf8('settings:another-project'));
    const foreign = { key: toBase64Url(other.key), ciphertext: toBase64Url(other.ciphertext) };
    const settings = createProjectSettings({ client, vault, stored });

    const opening = notified(settings);
    settings.view(PROJECT, foreign, 'unlocked');
    await opening;
    expect(settings.view(PROJECT, foreign, 'unlocked').worktree).toEqual({ state: 'unreadable' });

    await settings.change(PROJECT, 'worktree:clean', 'rm -rf .cache');
    expect(await sealer(vault).decoded(calls.at(-1)?.body['worktreeCommands'] as SealedItem)).toEqual({ prepare: null, clean: 'rm -rf .cache' });
  });

  it.each([
    ['no item', null],
    ['an item', { prepare: 'npm ci', clean: null }],
  ] as const)(
    'keeps what it saved over %s while the store still holds the item before, the other field then sealed with it; another tab’s item opened again',
    async (_, before) => {
      const { client, stored, store, calls } = fakeClient();
      const vault = await unlockedVault();
      const { seal, decoded } = sealer(vault);
      if (before) store.write(await seal(before));
      const settings = createProjectSettings({ client, vault, stored });
      // The page renders on each change of this state, with what the store holds (router.refresh()).
      const views: unknown[] = [];
      settings.subscribe(() => views.push(settings.view(PROJECT, store.inStore(), 'unlocked').worktree));
      const opening = before ? notified(settings) : Promise.resolve();
      settings.view(PROJECT, store.inStore(), 'unlocked');
      await opening;

      // The HTTP answer comes before settings.upserted: the store still holds the item before.
      await settings.change(PROJECT, 'worktree:prepare', 'pnpm install');
      await new Promise((done) => setTimeout(done, 20));
      expect(settings.view(PROJECT, store.inStore(), 'unlocked').worktree).toEqual({ state: 'open', prepare: 'pnpm install', clean: '' });
      await settings.change(PROJECT, 'worktree:clean', 'rm -rf .cache');
      await new Promise((done) => setTimeout(done, 20));
      expect(await decoded(calls.at(-1)?.body['worktreeCommands'] as SealedItem)).toEqual({ prepare: 'pnpm install', clean: 'rm -rf .cache' });
      expect(views).not.toContainEqual({ state: 'open', prepare: '', clean: 'rm -rf .cache' });

      // The events then come, in order: what the page shows stays what it saved.
      store.deliver(0);
      expect(settings.view(PROJECT, store.inStore(), 'unlocked').worktree).toEqual({ state: 'open', prepare: 'pnpm install', clean: 'rm -rf .cache' });
      store.deliver(1);
      expect(settings.view(PROJECT, store.inStore(), 'unlocked').worktree).toEqual({ state: 'open', prepare: 'pnpm install', clean: 'rm -rf .cache' });

      // Another tab writes its own item: opened, as any item the page did not seal.
      store.write(await seal({ prepare: 'make setup', clean: null }));
      const reopening = notified(settings);
      settings.view(PROJECT, store.inStore(), 'unlocked');
      await reopening;
      expect(settings.view(PROJECT, store.inStore(), 'unlocked').worktree).toEqual({ state: 'open', prepare: 'make setup', clean: '' });
    },
  );

  it('keeps both Commandes changed one after the other before the first answer, the store then catching up', async () => {
    const { client, stored, store, calls } = fakeClient();
    const vault = await unlockedVault();
    const settings = createProjectSettings({ client, vault, stored });
    const views: unknown[] = [];
    settings.subscribe(() => views.push(settings.view(PROJECT, store.inStore(), 'unlocked').worktree));
    settings.view(PROJECT, store.inStore(), 'unlocked');

    await Promise.all([settings.change(PROJECT, 'worktree:prepare', 'pnpm install'), settings.change(PROJECT, 'worktree:clean', 'rm -rf .cache')]);
    for (const index of calls.keys()) {
      store.deliver(index);
      expect(settings.view(PROJECT, store.inStore(), 'unlocked').worktree).toEqual({ state: 'open', prepare: 'pnpm install', clean: 'rm -rf .cache' });
    }
    expect(views).not.toContainEqual({ state: 'opening' });
  });

  it('keeps a Commande emptied after it was saved, before either event, the first event then delivered and the other field changed', async () => {
    const { client, stored, store, calls } = fakeClient();
    const vault = await unlockedVault();
    const settings = createProjectSettings({ client, vault, stored });
    settings.subscribe(() => settings.view(PROJECT, store.inStore(), 'unlocked'));
    settings.view(PROJECT, store.inStore(), 'unlocked');

    await settings.change(PROJECT, 'worktree:prepare', 'pnpm install');
    await settings.change(PROJECT, 'worktree:prepare', '');
    expect(calls.map((call) => call.body['worktreeCommands'] === null)).toEqual([false, true]);
    // The store still holds no item: the page's emptying is not confirmed by it.
    expect(settings.view(PROJECT, store.inStore(), 'unlocked').worktree).toEqual({ state: 'open', prepare: '', clean: '' });
    // The first save's event, late.
    store.deliver(0);
    await new Promise((done) => setTimeout(done, 20));
    expect(settings.view(PROJECT, store.inStore(), 'unlocked').worktree).toEqual({ state: 'open', prepare: '', clean: '' });

    await settings.change(PROJECT, 'worktree:clean', 'rm -rf .cache');
    expect(await sealer(vault).decoded(calls.at(-1)?.body['worktreeCommands'] as SealedItem)).toEqual({ prepare: null, clean: 'rm -rf .cache' });

    // The other events, in order: the emptying, then the last item; the store then holds what the page saved.
    for (const index of [1, 2]) {
      store.deliver(index);
      expect(settings.view(PROJECT, store.inStore(), 'unlocked').worktree).toEqual({ state: 'open', prepare: '', clean: 'rm -rf .cache' });
    }
    // Another tab removes them: shown, the page's saves all in the store.
    store.write(null);
    expect(settings.view(PROJECT, store.inStore(), 'unlocked').worktree).toEqual({ state: 'open', prepare: '', clean: '' });
  });

  it.each([
    ['an item, its own event come after its answer', 'pnpm install', false],
    ['an item, its own event come before its answer', 'pnpm install', true],
    ['blanks (no item over no item), its own event come before its answer', '   ', true],
  ] as const)('settles its saves on the store’s events while the page is closed, for %s: another tab’s item, come meanwhile, opened on return and kept by the other field', async (_, typed, late) => {
    const { client, stored, store, calls, answer } = fakeClient();
    const vault = await unlockedVault();
    const { seal, decoded } = sealer(vault);
    const settings = createProjectSettings({ client, vault, stored });
    settings.view(PROJECT, store.inStore(), 'unlocked');

    let release = () => undefined as void;
    if (late) {
      // Committed at once, the answer waits until both events below came: its own, then another tab's item.
      const gate = new Promise<void>((done) => (release = done));
      answer(async (body, commit) => {
        commit();
        await gate;
        return settingsOf(body['worktreeCommands'] as SealedItem | null);
      });
    }
    const saving = settings.change(PROJECT, 'worktree:prepare', typed);
    if (late) {
      await new Promise((done) => setTimeout(done, 20));
      expect(calls).toHaveLength(1);
      // An event of something else meanwhile changes nothing of this Projet's.
      store.tell();
      store.deliver(0);
      store.write(await seal({ prepare: 'pnpm ci', clean: null }));
      release();
      await saving;
    } else {
      await saving;
      // The Pilote leaves the page: no view() while its event, then another tab's item, come.
      store.deliver(0);
      store.write(await seal({ prepare: 'pnpm ci', clean: null }));
    }
    expect(store.listeners.size).toBe(0);

    // Back on the page: the other tab's item opened, and kept by a change of the other field.
    const reopening = notified(settings);
    expect(settings.view(PROJECT, store.inStore(), 'unlocked').worktree).toEqual({ state: 'opening' });
    await reopening;
    expect(settings.view(PROJECT, store.inStore(), 'unlocked').worktree).toEqual({ state: 'open', prepare: 'pnpm ci', clean: '' });
    await settings.change(PROJECT, 'worktree:clean', 'rm -rf .cache');
    expect(await decoded(calls.at(-1)?.body['worktreeCommands'] as SealedItem)).toEqual({ prepare: 'pnpm ci', clean: 'rm -rf .cache' });
  });

  it.each([
    ['before the outage', false],
    ['during the outage', true],
  ] as const)('holds a save answered %s once a snapshot covers it, its event replaced by the snapshot of another tab’s later item, the other field then keeping it', async (_, late) => {
    const { client, stored, store, calls, answer } = fakeClient();
    const vault = await unlockedVault();
    const { seal, decoded } = sealer(vault);
    const settings = createProjectSettings({ client, vault, stored });
    settings.view(PROJECT, store.inStore(), 'unlocked');
    let release = () => undefined as void;
    if (late) {
      const gate = new Promise<void>((done) => (release = done));
      answer(async (body, commit) => {
        commit();
        await gate;
        return settingsOf(body['worktreeCommands'] as SealedItem | null);
      });
    }
    const saving = settings.change(PROJECT, 'worktree:prepare', 'pnpm install');
    if (!late) await saving;
    await new Promise((done) => setTimeout(done, 20));

    // The socket lost: the save's event never comes; another tab writes; the snapshot holds its item.
    store.write(await seal({ prepare: 'pnpm ci', clean: null }), { event: false });
    store.snapshot();
    release();
    await saving;
    expect(store.listeners.size).toBe(0);

    const reopening = notified(settings);
    expect(settings.view(PROJECT, store.inStore(), 'unlocked').worktree).toEqual({ state: 'opening' });
    await reopening;
    expect(settings.view(PROJECT, store.inStore(), 'unlocked').worktree).toEqual({ state: 'open', prepare: 'pnpm ci', clean: '' });
    await settings.change(PROJECT, 'worktree:clean', 'rm -rf .cache');
    expect(await decoded(calls.at(-1)?.body['worktreeCommands'] as SealedItem)).toEqual({ prepare: 'pnpm ci', clean: 'rm -rf .cache' });
  });

  it('keeps a save committed after the snapshot of a resynchronisation, its answer come before its event, the other field then sealed with it', async () => {
    const { client, stored, store, calls, answer } = fakeClient();
    const vault = await unlockedVault();
    const settings = createProjectSettings({ client, vault, stored });
    const views: unknown[] = [];
    settings.subscribe(() => views.push(settings.view(PROJECT, store.inStore(), 'unlocked').worktree));
    settings.view(PROJECT, store.inStore(), 'unlocked');
    // The request on its way while the store resynchronises: committed only after its snapshot, which holds no Commandes.
    let release = () => undefined as void;
    const gate = new Promise<void>((done) => (release = done));
    answer(async (body, commit) => {
      await gate;
      commit();
      return settingsOf(body['worktreeCommands'] as SealedItem | null);
    });
    const saving = settings.change(PROJECT, 'worktree:prepare', 'pnpm install');
    await new Promise((done) => setTimeout(done, 20));
    store.snapshot();
    release();
    await saving;

    expect(settings.view(PROJECT, store.inStore(), 'unlocked').worktree).toEqual({ state: 'open', prepare: 'pnpm install', clean: '' });
    answer(async (body) => settingsOf(body['worktreeCommands'] as SealedItem | null));
    await settings.change(PROJECT, 'worktree:clean', 'rm -rf .cache');
    expect(await sealer(vault).decoded(calls.at(-1)?.body['worktreeCommands'] as SealedItem)).toEqual({ prepare: 'pnpm install', clean: 'rm -rf .cache' });
    expect(views).not.toContainEqual({ state: 'open', prepare: '', clean: '' });

    // Their events then come: the store holds what the page saved, nothing more to wait for.
    store.deliver(0);
    store.deliver(1);
    expect(settings.view(PROJECT, store.inStore(), 'unlocked').worktree).toEqual({ state: 'open', prepare: 'pnpm install', clean: 'rm -rf .cache' });
    expect(store.listeners.size).toBe(0);
  });

  it('keeps a Commande refused on its field, with the text typed', async () => {
    const { client, stored, answer } = fakeClient();
    const vault = await unlockedVault();
    const settings = createProjectSettings({ client, vault, stored });
    settings.view(PROJECT, null, 'unlocked');
    answer(async () => {
      throw refusal({ worktreeCommands: 'Les Commandes sont trop longues.' });
    });

    await settings.change(PROJECT, 'worktree:prepare', 'pnpm install');
    expect(settings.view(PROJECT, null, 'unlocked')).toMatchObject({
      errors: { 'worktree:prepare': 'Les Commandes sont trop longues.' },
      drafts: { 'worktree:prepare': 'pnpm install' },
    });
  });
});
