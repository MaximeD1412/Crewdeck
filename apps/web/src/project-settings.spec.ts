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

const stored = (worktreeCommands: SealedItem | null = null): ProjectSettings => ({
  projectId: PROJECT,
  effective: { ...DEFAULT_ACCOUNT_SETTINGS, timeZone: 'Europe/Paris' },
  origins: { roles: { idea: 'compte', design: 'compte', code: 'compte', review: 'compte' }, notifications: { push: 'compte' } },
  changedCount: 0,
  branches: { integration: 'develop', release: 'main' },
  worktreeCommands,
});

/** The API at the page's boundary: each command recorded, answered with what the server stored, or refused. */
const fakeClient = () => {
  const calls: { method: string; path: string; body: Record<string, unknown> }[] = [];
  let answer: (body: Record<string, unknown>) => Promise<ProjectSettings> = async (body) => {
    const sent = body['worktreeCommands'] as SealedItem | null | undefined;
    return stored(sent ?? null);
  };
  const client = {
    command: vi.fn(async (method: string, path: string, body: object) => {
      calls.push({ method, path, body: body as Record<string, unknown> });
      return answer(body as Record<string, unknown>);
    }),
  };
  return { client: client as never, calls, answer: (next: typeof answer) => (answer = next) };
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
    const { client, calls } = fakeClient();
    const settings = createProjectSettings({ client });

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
    const { client, calls } = fakeClient();
    const settings = createProjectSettings({ client });

    await settings.revert(PROJECT, 'role:review');
    await settings.revert(PROJECT, 'push');
    await settings.revert(PROJECT, 'branch:release');
    expect(calls.map((call) => call.body)).toEqual([{ roles: { review: null } }, { notifications: { push: null } }]);
  });

  it('ignores a control it does not know, and a value of the wrong kind', async () => {
    const { client, calls } = fakeClient();
    const settings = createProjectSettings({ client });

    await settings.change(PROJECT, 'unknown', true);
    await settings.change(PROJECT, 'push', 'on');
    await settings.change(PROJECT, 'role:code', 'no-model');
    await settings.change(PROJECT, 'branch:other', 'x');
    expect(calls).toEqual([]);
  });

  it('keeps a branch typed while it is on its way and once refused, the refusal on its field; drops both once stored', async () => {
    const { client, answer } = fakeClient();
    const settings = createProjectSettings({ client });
    answer(async () => {
      expect(settings.view(PROJECT, null, 'locked').drafts).toEqual({ 'branch:release': 'prod..x' });
      throw refusal({ 'branches.release': 'Ce nom de branche n’est pas valide.' });
    });

    await settings.change(PROJECT, 'branch:release', 'prod..x');
    expect(settings.view(PROJECT, null, 'locked')).toMatchObject({ drafts: { 'branch:release': 'prod..x' }, errors: { 'branch:release': 'Ce nom de branche n’est pas valide.' } });

    answer(async () => stored());
    await settings.change(PROJECT, 'branch:release', 'prod');
    expect(settings.view(PROJECT, null, 'locked')).toMatchObject({ drafts: {}, errors: {} });
  });

  it('puts a refusal without a field’s message on the control, by its message', async () => {
    const { client, answer } = fakeClient();
    const settings = createProjectSettings({ client });
    answer(async () => {
      throw refusal();
    });

    await settings.change(PROJECT, 'role:code', 'codex:gpt-5.5');
    expect(settings.view(PROJECT, null, 'locked').errors).toEqual({ 'role:code': 'Vérifie les champs signalés.' });
  });

  it('sends a Projet’s changes one after the other, in the order given', async () => {
    const { client, calls, answer } = fakeClient();
    const settings = createProjectSettings({ client });
    let release: () => void = () => undefined;
    answer(() => new Promise((resolve) => (release = () => resolve(stored()))));

    const first = settings.change(PROJECT, 'branch:integration', 'a');
    const second = settings.change(PROJECT, 'branch:integration', 'b');
    await Promise.resolve();
    expect(calls).toHaveLength(1);
    answer(async () => stored());
    release();
    await Promise.all([first, second]);
    expect(calls.map((call) => call.body)).toEqual([{ branches: { integration: 'a' } }, { branches: { integration: 'b' } }]);
  });
});

describe('createProjectSettings, the worktree Commandes', () => {
  it('keeps them locked, and sends nothing, while the vault is locked or the browser has none', async () => {
    const { client, calls } = fakeClient();
    const vault = await unlockedVault();
    expect(createProjectSettings({ client, vault }).view(PROJECT, null, 'locked').worktree).toEqual({ state: 'locked' });
    expect(createProjectSettings({ client, vault }).view(PROJECT, null, 'no-device').worktree).toEqual({ state: 'locked' });
    const without = createProjectSettings({ client });
    expect(without.view(PROJECT, null, 'unlocked').worktree).toEqual({ state: 'locked' });

    await without.change(PROJECT, 'worktree:prepare', 'pnpm install');
    expect(calls).toEqual([]);
  });

  it('seals both in one item before they leave the page, and opens it again after a reload', async () => {
    const { client, calls } = fakeClient();
    const vault = await unlockedVault();
    const settings = createProjectSettings({ client, vault });
    expect(settings.view(PROJECT, null, 'unlocked').worktree).toEqual({ state: 'open', prepare: '', clean: '' });

    await settings.change(PROJECT, 'worktree:prepare', 'pnpm install');
    await settings.change(PROJECT, 'worktree:clean', 'rm -rf .cache');
    expect(JSON.stringify(calls)).not.toMatch(/pnpm|rm -rf/);
    const sent = calls.at(-1)?.body['worktreeCommands'] as SealedItem;
    const opened = await vault.openItem({ key: fromBase64Url(sent.key), ciphertext: fromBase64Url(sent.ciphertext) }, AAD);
    expect(JSON.parse(new TextDecoder().decode(opened))).toEqual({ prepare: 'pnpm install', clean: 'rm -rf .cache' });
    expect(settings.view(PROJECT, sent, 'unlocked')).toMatchObject({ drafts: {}, worktree: { state: 'open', prepare: 'pnpm install', clean: 'rm -rf .cache' } });

    // A reload: a new page, the same vault, the item the server kept.
    const reloaded = createProjectSettings({ client, vault });
    const opening = notified(reloaded);
    expect(reloaded.view(PROJECT, sent, 'unlocked').worktree).toEqual({ state: 'opening' });
    await opening;
    expect(reloaded.view(PROJECT, sent, 'unlocked').worktree).toEqual({ state: 'open', prepare: 'pnpm install', clean: 'rm -rf .cache' });
  });

  it('removes the item when both are emptied', async () => {
    const { client, calls } = fakeClient();
    const vault = await unlockedVault();
    const settings = createProjectSettings({ client, vault });
    settings.view(PROJECT, null, 'unlocked');

    await settings.change(PROJECT, 'worktree:prepare', 'pnpm install');
    await settings.change(PROJECT, 'worktree:prepare', '   ');
    expect(calls.at(-1)?.body).toEqual({ worktreeCommands: null });
  });

  it('says an item this vault cannot open is unreadable, and replaces it with what the Pilote writes', async () => {
    const { client, calls } = fakeClient();
    const vault = await unlockedVault();
    const other = await vault.sealItem(utf8(JSON.stringify({ prepare: 'x', clean: null })), utf8('settings:another-project'));
    const foreign = { key: toBase64Url(other.key), ciphertext: toBase64Url(other.ciphertext) };
    const settings = createProjectSettings({ client, vault });

    const opening = notified(settings);
    settings.view(PROJECT, foreign, 'unlocked');
    await opening;
    expect(settings.view(PROJECT, foreign, 'unlocked').worktree).toEqual({ state: 'unreadable' });

    await settings.change(PROJECT, 'worktree:clean', 'rm -rf .cache');
    const sent = calls.at(-1)?.body['worktreeCommands'] as SealedItem;
    const opened = await vault.openItem({ key: fromBase64Url(sent.key), ciphertext: fromBase64Url(sent.ciphertext) }, AAD);
    expect(JSON.parse(new TextDecoder().decode(opened))).toEqual({ prepare: null, clean: 'rm -rf .cache' });
  });

  it.each([
    ['no item', null],
    ['an item', { prepare: 'npm ci', clean: null }],
  ] as const)(
    'keeps what it saved over %s while the store still holds the item before, the other field then sealed with it; another tab’s item opened again',
    async (_, before) => {
      const { client, calls } = fakeClient();
      const vault = await unlockedVault();
      const seal = async (commands: object): Promise<SealedItem> => {
        const item = await vault.sealItem(utf8(JSON.stringify(commands)), AAD);
        return { key: toBase64Url(item.key), ciphertext: toBase64Url(item.ciphertext) };
      };
      const decoded = async (item: SealedItem) =>
        JSON.parse(new TextDecoder().decode(await vault.openItem({ key: fromBase64Url(item.key), ciphertext: fromBase64Url(item.ciphertext) }, AAD))) as unknown;
      let inStore: SealedItem | null = before ? await seal(before) : null;
      const settings = createProjectSettings({ client, vault });
      // The page renders on each change of this state, with what the store holds (router.refresh()).
      const views: unknown[] = [];
      settings.subscribe(() => views.push(settings.view(PROJECT, inStore, 'unlocked').worktree));
      const opening = before ? notified(settings) : Promise.resolve();
      settings.view(PROJECT, inStore, 'unlocked');
      await opening;

      // The HTTP answer comes before settings.upserted: the store still holds the item before.
      await settings.change(PROJECT, 'worktree:prepare', 'pnpm install');
      await new Promise((done) => setTimeout(done, 20));
      expect(settings.view(PROJECT, inStore, 'unlocked').worktree).toEqual({ state: 'open', prepare: 'pnpm install', clean: '' });
      await settings.change(PROJECT, 'worktree:clean', 'rm -rf .cache');
      await new Promise((done) => setTimeout(done, 20));
      expect(await decoded(calls.at(-1)?.body['worktreeCommands'] as SealedItem)).toEqual({ prepare: 'pnpm install', clean: 'rm -rf .cache' });
      expect(views).not.toContainEqual({ state: 'open', prepare: '', clean: 'rm -rf .cache' });

      // The events then come, in order: what the page shows stays what it saved.
      inStore = calls[0]?.body['worktreeCommands'] as SealedItem;
      expect(settings.view(PROJECT, inStore, 'unlocked').worktree).toEqual({ state: 'open', prepare: 'pnpm install', clean: 'rm -rf .cache' });
      inStore = calls[1]?.body['worktreeCommands'] as SealedItem;
      expect(settings.view(PROJECT, inStore, 'unlocked').worktree).toEqual({ state: 'open', prepare: 'pnpm install', clean: 'rm -rf .cache' });

      // Another tab writes its own item: opened, as any item the page did not seal.
      inStore = await seal({ prepare: 'make setup', clean: null });
      const reopening = notified(settings);
      settings.view(PROJECT, inStore, 'unlocked');
      await reopening;
      expect(settings.view(PROJECT, inStore, 'unlocked').worktree).toEqual({ state: 'open', prepare: 'make setup', clean: '' });
    },
  );

  it('keeps both Commandes changed one after the other before the first answer, the store then catching up', async () => {
    const { client, calls } = fakeClient();
    const vault = await unlockedVault();
    let inStore: SealedItem | null = null;
    const settings = createProjectSettings({ client, vault });
    const views: unknown[] = [];
    settings.subscribe(() => views.push(settings.view(PROJECT, inStore, 'unlocked').worktree));
    settings.view(PROJECT, inStore, 'unlocked');

    await Promise.all([settings.change(PROJECT, 'worktree:prepare', 'pnpm install'), settings.change(PROJECT, 'worktree:clean', 'rm -rf .cache')]);
    for (const call of calls) {
      inStore = call.body['worktreeCommands'] as SealedItem;
      expect(settings.view(PROJECT, inStore, 'unlocked').worktree).toEqual({ state: 'open', prepare: 'pnpm install', clean: 'rm -rf .cache' });
    }
    expect(views).not.toContainEqual({ state: 'opening' });
  });

  it('keeps a Commande emptied after it was saved, before either event, the first event then delivered and the other field changed', async () => {
    const { client, calls } = fakeClient();
    const vault = await unlockedVault();
    let inStore: SealedItem | null = null;
    const settings = createProjectSettings({ client, vault });
    settings.subscribe(() => settings.view(PROJECT, inStore, 'unlocked'));
    settings.view(PROJECT, inStore, 'unlocked');

    await settings.change(PROJECT, 'worktree:prepare', 'pnpm install');
    await settings.change(PROJECT, 'worktree:prepare', '');
    expect(calls.map((call) => call.body['worktreeCommands'] === null)).toEqual([false, true]);
    // The store still holds no item: the page's emptying is not confirmed by it.
    expect(settings.view(PROJECT, inStore, 'unlocked').worktree).toEqual({ state: 'open', prepare: '', clean: '' });
    // The first save's event, late.
    inStore = calls[0]?.body['worktreeCommands'] as SealedItem;
    settings.view(PROJECT, inStore, 'unlocked');
    await new Promise((done) => setTimeout(done, 20));
    expect(settings.view(PROJECT, inStore, 'unlocked').worktree).toEqual({ state: 'open', prepare: '', clean: '' });

    await settings.change(PROJECT, 'worktree:clean', 'rm -rf .cache');
    const sent = calls.at(-1)?.body['worktreeCommands'] as SealedItem;
    const opened = await vault.openItem({ key: fromBase64Url(sent.key), ciphertext: fromBase64Url(sent.ciphertext) }, AAD);
    expect(JSON.parse(new TextDecoder().decode(opened))).toEqual({ prepare: null, clean: 'rm -rf .cache' });

    // The other events, in order: the emptying, then the last item; the store then holds what the page saved.
    for (const call of calls.slice(1)) {
      inStore = call.body['worktreeCommands'] as SealedItem | null;
      expect(settings.view(PROJECT, inStore, 'unlocked').worktree).toEqual({ state: 'open', prepare: '', clean: 'rm -rf .cache' });
    }
    // Another tab removes them: shown, the page's saves all confirmed.
    inStore = null;
    expect(settings.view(PROJECT, inStore, 'unlocked').worktree).toEqual({ state: 'open', prepare: '', clean: '' });
  });

  it.each([
    ['an item, its own event come after its answer', 'pnpm install', false],
    ['an item, its own event come before its answer', 'pnpm install', true],
    ['blanks (no item over no item), its own event come before its answer', '   ', true],
  ] as const)('settles its saves on the store’s events while the page is closed, for %s: another tab’s item, come meanwhile, opened on return and kept by the other field', async (_, typed, late) => {
    const { client, calls, answer } = fakeClient();
    const vault = await unlockedVault();
    const seal = async (commands: object): Promise<SealedItem> => {
      const item = await vault.sealItem(utf8(JSON.stringify(commands)), AAD);
      return { key: toBase64Url(item.key), ciphertext: toBase64Url(item.ciphertext) };
    };
    // The store at the page's boundary: the Projet's Paramètres, a new object on each of its events, its listeners told.
    let inStore: SealedItem | null = null;
    let own = stored(inStore);
    const listeners = new Set<() => void>();
    const deliver = (item: SealedItem | null) => {
      inStore = item;
      own = stored(item);
      for (const listener of [...listeners]) listener();
    };
    const store = {
      projectSettings: (projectId: string) => (projectId === PROJECT ? own : undefined),
      subscribe: (fn: () => void) => {
        listeners.add(fn);
        return () => listeners.delete(fn);
      },
    };
    const settings = createProjectSettings({ client, vault, stored: store });
    settings.view(PROJECT, inStore, 'unlocked');

    const saving = settings.change(PROJECT, 'worktree:prepare', typed);
    if (late) {
      // The answer waits until both events below came: its own, then another tab's item.
      let release = () => undefined as void;
      const gate = new Promise<void>((done) => (release = done));
      answer(async (body) => {
        await gate;
        return stored(body['worktreeCommands'] as SealedItem | null);
      });
      await new Promise((done) => setTimeout(done, 20));
      expect(calls).toHaveLength(1);
      // An event of something else meanwhile (another Projet's, the account's) changes nothing of this Projet's.
      for (const listener of [...listeners]) listener();
      deliver(calls[0]?.body['worktreeCommands'] as SealedItem | null);
      deliver(await seal({ prepare: 'pnpm ci', clean: null }));
      release();
      await saving;
    } else {
      await saving;
      // The Pilote leaves the page: no view() while its event, then another tab's item, come.
      deliver(calls[0]?.body['worktreeCommands'] as SealedItem | null);
      deliver(await seal({ prepare: 'pnpm ci', clean: null }));
    }
    expect(listeners.size).toBe(0);

    // Back on the page: the other tab's item opened, and kept by a change of the other field.
    const reopening = notified(settings);
    expect(settings.view(PROJECT, inStore, 'unlocked').worktree).toEqual({ state: 'opening' });
    await reopening;
    expect(settings.view(PROJECT, inStore, 'unlocked').worktree).toEqual({ state: 'open', prepare: 'pnpm ci', clean: '' });
    await settings.change(PROJECT, 'worktree:clean', 'rm -rf .cache');
    const sent = calls.at(-1)?.body['worktreeCommands'] as SealedItem;
    const opened = await vault.openItem({ key: fromBase64Url(sent.key), ciphertext: fromBase64Url(sent.ciphertext) }, AAD);
    expect(JSON.parse(new TextDecoder().decode(opened))).toEqual({ prepare: 'pnpm ci', clean: 'rm -rf .cache' });
  });

  it('keeps a Commande refused on its field, with the text typed', async () => {
    const { client, answer } = fakeClient();
    const vault = await unlockedVault();
    const settings = createProjectSettings({ client, vault });
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
