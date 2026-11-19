import { type AiAccount, DEFAULT_ACCOUNT_SETTINGS, type Me } from '@crewdeck/contracts';
import { emitAction, PageParametres, RoleSettings } from '@crewdeck/sdk';
import { createDispatcher } from './actions/dispatcher.js';
import { boot } from './app.js';
import { createStore } from './store/store.js';

const PILOT: Me = { id: '018f6b2a-7c3d-7e4f-9a1b-2c3d4e5f6a7b', displayName: 'octocat', avatarUrl: null, timeZone: 'Europe/Paris', gettingStartedStep: 'done', identities: [] };

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
    const settings = { ...DEFAULT_ACCOUNT_SETTINGS, timeZone: 'Europe/Paris', projects: [] };
    const command = vi.fn<(...args: unknown[]) => Promise<never>>(async () => settings as never);
    const app = await boot({
      root,
      dispatcher: createDispatcher(),
      me: async () => PILOT,
      store,
      connection: { start: vi.fn<() => void>(), stop: vi.fn<() => void>() },
      client: { command, query: vi.fn() },
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
    store.applySnapshot({ seq: 1, pilot: PILOT, runner: null, 'runner-link': null, 'ai-account': [codex], 'mcp-server': [], devices: [], projects: [], processes: [], phaseRuns: [], stepRuns: [], repositories: [], decisions: [], ideas: [], tickets: [], milestones: [], codeChanges: [], sessions: [], settings, usage: [] });
    expect(slotsOf()).toEqual(['roles', 'account', 'modders']);
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
    app.stop();
  });
});

