import { type AiAccount, DEFAULT_ACCOUNT_SETTINGS, type Me } from '@crewdeck/contracts';
import { AccountIdentities, emitAction, PageParametres, ProcessTemplateList, PushSettings, RoleSettings } from '@crewdeck/sdk';
import { createDispatcher } from './actions/dispatcher.js';
import { boot } from './app.js';
import { createStore } from './store/store.js';

const PILOT: Me = { id: '018f6b2a-7c3d-7e4f-9a1b-2c3d4e5f6a7b', displayName: 'octocat', avatarUrl: null, timeZone: 'Europe/Paris', gettingStartedStep: 'done', identities: [{ provider: 'email', label: 'pilote@example.com', reconnect: false }], githubLinked: false };

const VAPID = 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U';
const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/abc';
const KEYS = { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', auth: 'tBHItJI5svbpez7KI4CCXg' };
const push = {
  available: true,
  endpoint: vi.fn(async () => null),
  subscribe: vi.fn(async (key: Promise<string>) => {
    await key;
    return { endpoint: ENDPOINT, keys: KEYS };
  }),
  unsubscribe: vi.fn(async () => undefined),
};

// Its own file: a page has one Skin, booted once.
describe('the page’s Paramètres', () => {
  it('open at /parametres: « Pour les Moddeurs », then « Rôles et modèles », « Connexion » and « Compte » once the store has the settings, following their events; a time zone picked is sent to PATCH /api/settings; the Rôles’ actions open « Nouveau Rôle », add, choose and remove a Rôle; « Relier GitHub » leaves for the link', async () => {
    history.replaceState(null, '', '/parametres?erreur=github-already-linked');
    const root = document.createElement('div');
    document.body.append(root);
    const store = createStore();
    store.registerSlice('pilot', { shape: 'single' });
    store.registerSlice('settings', { shape: 'single' });
    store.registerSlice('ai-account', { shape: 'collection' });
    store.registerSlice('push-subscription', { shape: 'collection', snapshotKey: 'push-subscriptions' });
    store.registerSlice('process-template', { shape: 'collection', snapshotKey: 'processTemplates' });
    const settings = { ...DEFAULT_ACCOUNT_SETTINGS, timeZone: 'Europe/Paris', projects: [] };
    const command = vi.fn<(...args: unknown[]) => Promise<never>>(async () => settings as never);
    const leave = vi.fn<(url: string) => void>();
    const app = await boot({
      leave,
      root,
      dispatcher: createDispatcher(),
      me: async () => PILOT,
      store,
      connection: { start: vi.fn<() => void>(), stop: vi.fn<() => void>() },
      client: { command, query: vi.fn(async () => ({ vapidPublicKey: VAPID })) as never },
      push,
    });

    const page = root.querySelector('cd-page-parametres') as HTMLElement;
    expect(page.closest('cd-cadre')).toBe(root.firstElementChild);
    const slotsOf = () => [...page.children].map((child) => child.getAttribute('slot'));
    expect(slotsOf()).toEqual(['modders']);

    const codex: AiAccount = {
      id: '019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6b02',
      engine: 'codex',
      installed: true,
      version: '1.0.0',
      knownVersion: true,
      kind: 'api-key',
      state: 'connected',
      models: [{ id: 'gpt-5.5', label: 'GPT-5.5', usable: true }],
      reportedAt: '2026-11-11T08:30:00.000Z',
    };
    store.applySnapshot({ seq: 1, pilot: PILOT, runner: null, 'runner-link': null, 'ai-account': [codex], 'mcp-server': [], devices: [], 'push-subscriptions': [], vault: { version: 1, rotationPending: false }, sourceMigrations: [], projects: [], processes: [], processTemplates: [], phaseRuns: [], stepRuns: [], repositories: [], decisions: [], ideas: [], tickets: [], milestones: [], codeChanges: [], sessions: [], settings, usage: [] });
    expect(slotsOf()).toEqual(['roles', 'notifications', 'account', 'account', 'process-templates', 'modders']);
    const identities = page.querySelector('cd-account-identities[slot=account]') as HTMLElement & { data: unknown };
    expect(identities.nextElementSibling?.matches('cd-card[slot=account]')).toBe(true);
    expect(identities.data).toEqual({ identities: PILOT.identities, error: 'github-already-linked' });
    emitAction(identities, AccountIdentities, 'linkGitHub', {});
    expect(leave).toHaveBeenCalledWith('/api/auth/github/link?next=%2Fparametres');
    const select = page.querySelector('cd-card[slot=account] cd-select') as HTMLElement & { data: { value: string } };
    expect(select.data.value).toBe('Europe/Paris');

    store.applyEvent({ seq: 2, type: 'settings.upserted', payload: { ...settings, timeZone: 'Asia/Tokyo' }, at: '2026-11-11T08:00:00.000Z' });
    expect(page.querySelector('cd-card[slot=account] cd-select')).toBe(select);
    expect(select.data.value).toBe('Asia/Tokyo');

    emitAction(page, PageParametres, 'change', { name: 'timeZone', value: 'America/Montreal' });
    expect(command).toHaveBeenCalledWith('PATCH', '/api/settings', { timeZone: 'America/Montreal' }, expect.anything());
    emitAction(page, PageParametres, 'change', { name: 'unknown', value: true });
    expect(command).toHaveBeenCalledTimes(1);

    const roles = page.querySelector('cd-role-settings[slot=roles]') as HTMLElement & { data: { models: unknown[]; roles: { id: string; choice: unknown }[]; adding: { open: boolean } } };
    expect(roles.data.models).toEqual([{ engine: 'codex', model: 'gpt-5.5', label: 'Codex · GPT-5.5' }]);
    expect(roles.data.roles.map((role) => role.id)).toEqual(['idea', 'design', 'code', 'review']);

    emitAction(roles, RoleSettings, 'add', {});
    await vi.waitFor(() => expect(roles.data.adding.open).toBe(true));
    emitAction(roles, RoleSettings, 'create', { name: 'Revue Codex', engine: 'codex', model: 'gpt-5.5' });
    await vi.waitFor(() => expect(roles.data.adding.open).toBe(false));
    expect(command).toHaveBeenCalledWith('POST', '/api/roles', { name: 'Revue Codex', engine: 'codex', model: 'gpt-5.5' }, expect.anything());

    emitAction(roles, RoleSettings, 'choose', { roleId: 'review', engine: 'codex', model: 'gpt-5.5' });
    await vi.waitFor(() => expect(command).toHaveBeenCalledWith('PATCH', '/api/settings', { roles: { review: { engine: 'codex', model: 'gpt-5.5' } } }, expect.anything()));
    emitAction(roles, RoleSettings, 'remove', { roleId: 'r-k3v9q2m7' });
    await vi.waitFor(() => expect(command).toHaveBeenCalledWith('DELETE', '/api/roles/r-k3v9q2m7', {}, expect.anything()));

    const notifications = page.querySelector('cd-push-settings[slot=notifications]') as HTMLElement & { data: { push: boolean; device: string; subscriptions: { id: string }[] } };
    expect(notifications.data).toMatchObject({ push: false, device: 'subscribe', subscriptions: [] });
    emitAction(notifications, PushSettings, 'toggle', { push: true });
    await vi.waitFor(() => expect(command).toHaveBeenCalledWith('PATCH', '/api/settings', { notifications: { push: true } }, expect.anything()));
    await vi.waitFor(() => expect(notifications.data.push).toBe(true));
    emitAction(notifications, PushSettings, 'subscribe', {});
    await vi.waitFor(() => expect(command).toHaveBeenCalledWith('POST', '/api/push-subscriptions', { endpoint: ENDPOINT, keys: KEYS, label: expect.any(String) }, expect.anything()));
    await expect(push.subscribe.mock.calls[0]?.[0]).resolves.toBe(VAPID);
    const row = { id: '019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6a02', endpoint: ENDPOINT, label: 'Chrome · Windows', createdAt: '2026-11-12T09:00:00.000Z' };
    store.applyEvent({ seq: 3, type: 'push-subscription.upserted', payload: row, at: '2026-11-12T09:00:00.000Z' });
    await vi.waitFor(() => expect(notifications.data.device).toBe('subscribed'));
    expect(notifications.data.subscriptions.map((subscription) => subscription.id)).toEqual([row.id]);
    emitAction(notifications, PushSettings, 'remove', { id: row.id });
    await vi.waitFor(() => expect(command).toHaveBeenCalledWith('DELETE', `/api/push-subscriptions/${row.id}`, {}));
    await vi.waitFor(() => expect(push.unsubscribe).toHaveBeenCalled());

    // « Modèles de process » (PROCESS-14): its Empty, then a Modèle saved in another tab, renamed and removed.
    const templates = page.querySelector('cd-process-template-list[slot=process-templates]') as HTMLElement & {
      data: { templates: { id: string; name: string; meta: string }[]; renaming: unknown; removing: unknown };
    };
    expect(templates.data).toEqual({ templates: [], renaming: null, removing: null });
    const template = {
      id: '019a6f00-0000-7000-8000-0000000000a1',
      name: 'Process Site mairie',
      fromProjectId: '019a6f00-0000-7000-8000-000000000011',
      fromVersionNumber: 3,
      sealed: null,
      commandCount: 0,
      createdAt: '2026-11-12T09:00:00.000Z',
      updatedAt: '2026-11-12T09:00:00.000Z',
    };
    store.applyEvent({ seq: 4, type: 'process-template.upserted', payload: template, at: template.updatedAt });
    await vi.waitFor(() => expect(templates.data.templates).toEqual([{ id: template.id, name: 'Process Site mairie', meta: 'depuis un Projet supprimé · 12 nov.' }]));
    emitAction(templates, ProcessTemplateList, 'rename', { id: template.id });
    await vi.waitFor(() => expect(templates.data.renaming).toEqual({ id: template.id, name: 'Process Site mairie', error: null }));
    emitAction(templates, ProcessTemplateList, 'submitRename', { id: template.id, name: 'Process mairie' });
    await vi.waitFor(() => expect(command).toHaveBeenCalledWith('PATCH', `/api/process-templates/${template.id}`, { name: 'Process mairie' }, expect.anything()));
    await vi.waitFor(() => expect(templates.data.renaming).toBeNull());
    emitAction(templates, ProcessTemplateList, 'remove', { id: template.id });
    await vi.waitFor(() => expect(templates.data.removing).toEqual({ id: template.id, name: 'Process Site mairie' }));
    emitAction(templates, ProcessTemplateList, 'cancel', {});
    await vi.waitFor(() => expect(templates.data.removing).toBeNull());
    emitAction(templates, ProcessTemplateList, 'remove', { id: template.id });
    emitAction(templates, ProcessTemplateList, 'confirmRemove', { id: template.id });
    await vi.waitFor(() => expect(command).toHaveBeenCalledWith('DELETE', `/api/process-templates/${template.id}`, {}));
    store.applyEvent({ seq: 5, type: 'process-template.removed', payload: { id: template.id }, at: template.updatedAt });
    await vi.waitFor(() => expect(templates.data.templates).toEqual([]));
    app.stop();
  });
});

