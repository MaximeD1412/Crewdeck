import { type AiAccount, DEFAULT_ACCOUNT_SETTINGS } from '@crewdeck/contracts';
import { emitAction, PageParametres, PushSettings, RoleSettings } from '@crewdeck/sdk';
import { createDispatcher } from './actions/dispatcher.js';
import { boot } from './app.js';
import { createStore } from './store/store.js';

const PILOT = { id: '018f6b2a-7c3d-7e4f-9a1b-2c3d4e5f6a7b', login: 'octocat', avatarUrl: null, timeZone: 'Europe/Paris', gettingStartedStep: 'done' } as const;

const VAPID = 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U';
const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/abc';
const KEYS = { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', auth: 'tBHItJI5svbpez7KI4CCXg' };
const push = {
  available: true,
  endpoint: vi.fn(async () => null),
  subscribe: vi.fn(async () => ({ endpoint: ENDPOINT, keys: KEYS })),
  unsubscribe: vi.fn(async () => undefined),
};

// Its own file: a page has one Skin, booted once.
describe('the page’s Paramètres', () => {
  it('open at /parametres: « Pour les Moddeurs », then « Rôles et modèles » and « Compte » once the store has the settings, following their events; a time zone picked is sent to PATCH /api/settings; the Rôles’ actions open « Nouveau Rôle », add, choose and remove a Rôle', async () => {
    history.replaceState(null, '', '/parametres');
    const root = document.createElement('div');
    document.body.append(root);
    const store = createStore();
    store.registerSlice('pilot', { shape: 'single' });
    store.registerSlice('settings', { shape: 'single' });
    store.registerSlice('ai-account', { shape: 'collection' });
    store.registerSlice('push-subscription', { shape: 'collection', snapshotKey: 'push-subscriptions' });
    const settings = { ...DEFAULT_ACCOUNT_SETTINGS, timeZone: 'Europe/Paris' };
    const command = vi.fn<(...args: unknown[]) => Promise<never>>(async () => settings as never);
    const app = await boot({
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
    store.applySnapshot({ seq: 1, pilot: PILOT, runner: null, 'runner-link': null, 'ai-account': [codex], 'mcp-server': [], devices: [], 'push-subscriptions': [], projects: [], processes: [], phaseRuns: [], stepRuns: [], repositories: [], decisions: [], tickets: [], milestones: [], codeChanges: [], settings });
    expect(slotsOf()).toEqual(['roles', 'notifications', 'account', 'modders']);
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
    emitAction(notifications, PushSettings, 'subscribe', {});
    await vi.waitFor(() => expect(command).toHaveBeenCalledWith('POST', '/api/push-subscriptions', { endpoint: ENDPOINT, keys: KEYS, label: expect.any(String) }, expect.anything()));
    expect(push.subscribe).toHaveBeenCalledWith(VAPID);
    const row = { id: '019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6a02', endpoint: ENDPOINT, label: 'Chrome · Windows', createdAt: '2026-11-12T09:00:00.000Z' };
    store.applyEvent({ seq: 3, type: 'push-subscription.upserted', payload: row, at: '2026-11-12T09:00:00.000Z' });
    await vi.waitFor(() => expect(notifications.data.device).toBe('subscribed'));
    expect(notifications.data.subscriptions.map((subscription) => subscription.id)).toEqual([row.id]);
    emitAction(notifications, PushSettings, 'remove', { id: row.id });
    await vi.waitFor(() => expect(command).toHaveBeenCalledWith('DELETE', `/api/push-subscriptions/${row.id}`, {}));
    await vi.waitFor(() => expect(push.unsubscribe).toHaveBeenCalled());
    app.stop();
  });
});

