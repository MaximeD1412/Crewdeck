import { DEFAULT_ACCOUNT_SETTINGS } from '@crewdeck/contracts';
import { t } from '@crewdeck/sdk';
import type { Client } from './api/client.js';
import { ApiError } from './api/request.js';
import { createRoleSettings } from './role-settings.js';

const SETTINGS = { ...DEFAULT_ACCOUNT_SETTINGS, timeZone: 'Europe/Paris' };
const CLOSED = { open: false, busy: false, nameError: null, modelError: null };
const REVUE = { name: 'Revue Codex', engine: 'codex', model: 'gpt-5.5' } as const;

const refused = (status: number, code: string, message: string, fields?: Record<string, string>) =>
  new ApiError({ status, code, message, ...(fields ? { fields } : {}) });

const setup = (answer: () => Promise<unknown> = async () => SETTINGS) => {
  const command = vi.fn<(...args: unknown[]) => Promise<unknown>>(answer);
  const roles = createRoleSettings({ client: { command: command as unknown as Client['command'] } });
  const changes = vi.fn<() => void>();
  roles.subscribe(changes);
  return { roles, command, changes };
};

describe('createRoleSettings', () => {
  it('opens and closes « Nouveau Rôle », each time without error', () => {
    const { roles, changes } = setup();
    expect(roles.view()).toEqual({ adding: CLOSED, errors: {} });
    roles.open();
    expect(roles.view().adding).toEqual({ ...CLOSED, open: true });
    roles.cancel();
    expect(roles.view().adding).toEqual(CLOSED);
    expect(changes).toHaveBeenCalledTimes(2);
  });

  it('adds the Rôle named with POST /api/roles, busy meanwhile, then closes', async () => {
    let answer: (value: unknown) => void = () => undefined;
    const { roles, command } = setup(() => new Promise((resolve) => (answer = resolve)));
    roles.open();
    const created = roles.create({ ...REVUE, name: '  Revue Codex ' });
    expect(roles.view().adding.busy).toBe(true);
    expect(command).toHaveBeenCalledWith('POST', '/api/roles', REVUE, expect.anything());
    answer(SETTINGS);
    await created;
    expect(roles.view().adding).toEqual(CLOSED);
  });

  it('asks for a name before sending anything', async () => {
    const { roles, command } = setup();
    roles.open();
    await roles.create({ ...REVUE, name: '   ' });
    expect(command).not.toHaveBeenCalled();
    expect(roles.view().adding).toEqual({ ...CLOSED, open: true, nameError: t('settings.roles.nameRequired') });
  });

  it('shows a refusal under its field, else under the name, the Dialog left open', async () => {
    const taken = setup(async () => {
      throw refused(409, 'roles.name-taken', 'Un Rôle porte déjà ce nom.', { name: 'Un Rôle porte déjà ce nom.' });
    });
    taken.roles.open();
    await taken.roles.create(REVUE);
    expect(taken.roles.view().adding).toEqual({ open: true, busy: false, nameError: 'Un Rôle porte déjà ce nom.', modelError: null });

    const unusable = setup(async () => {
      throw refused(422, 'settings.engine-unusable', 'Ce modèle n’est pas utilisable sur ton Runner.', { model: 'Ce modèle n’est pas utilisable sur ton Runner.' });
    });
    unusable.roles.open();
    await unusable.roles.create(REVUE);
    expect(unusable.roles.view().adding).toMatchObject({ nameError: null, modelError: 'Ce modèle n’est pas utilisable sur ton Runner.' });

    const many = setup(async () => {
      throw refused(422, 'roles.too-many', '20 Rôles au plus.');
    });
    many.roles.open();
    await many.roles.create(REVUE);
    expect(many.roles.view().adding).toMatchObject({ open: true, nameError: '20 Rôles au plus.' });
  });

  it('lets another failure through, the Dialog no longer busy', async () => {
    const { roles } = setup(async () => {
      throw new Error('offline');
    });
    roles.open();
    await expect(roles.create(REVUE)).rejects.toThrow('offline');
    expect(roles.view().adding).toEqual({ ...CLOSED, open: true });
  });

  it('chooses a model with PATCH /api/settings, a refusal shown on the row until the next try', async () => {
    let fail = true;
    const { roles, command } = setup(async () => {
      if (fail) throw refused(422, 'settings.engine-unusable', 'Ce modèle n’est pas utilisable sur ton Runner.', { 'roles.review': 'Ce modèle n’est pas utilisable sur ton Runner.' });
      return SETTINGS;
    });
    await roles.choose('review', { engine: 'codex', model: 'gpt-5.5' });
    expect(command).toHaveBeenCalledWith('PATCH', '/api/settings', { roles: { review: { engine: 'codex', model: 'gpt-5.5' } } }, expect.anything());
    expect(roles.view().errors).toEqual({ review: 'Ce modèle n’est pas utilisable sur ton Runner.' });
    fail = false;
    await roles.choose('review', { engine: 'claude-code', model: 'claude-opus-5-5' });
    expect(roles.view().errors).toEqual({});
  });

  it('removes a Rôle with DELETE /api/roles/:id, « en cours d’utilisation » shown on its row', async () => {
    const { roles, command } = setup(async () => {
      throw refused(409, 'roles.in-use', 'Des Étapes de tes Projets utilisent ce Rôle : change-les d’abord.');
    });
    await roles.remove('r-k3v9q2m7');
    expect(command).toHaveBeenCalledWith('DELETE', '/api/roles/r-k3v9q2m7', {}, expect.anything());
    expect(roles.view().errors).toEqual({ 'r-k3v9q2m7': 'Des Étapes de tes Projets utilisent ce Rôle : change-les d’abord.' });
  });

  it('sends a row’s choices one after the other, in the order picked, another row not waiting', async () => {
    const answers: ((value: unknown) => void)[] = [];
    const { roles, command } = setup(() => new Promise((resolve) => answers.push(resolve)));
    const patch = (roleId: string, engine: string, model: string) => ['PATCH', '/api/settings', { roles: { [roleId]: { engine, model } } }, expect.anything()];
    const first = roles.choose('code', { engine: 'codex', model: 'gpt-5.5' });
    const last = roles.choose('code', { engine: 'claude-code', model: 'claude-opus-5-5' });
    const other = roles.choose('idea', { engine: 'codex', model: 'gpt-5.5' });
    await vi.waitFor(() => expect(command).toHaveBeenCalledTimes(2));
    expect(command.mock.calls).toEqual([patch('code', 'codex', 'gpt-5.5'), patch('idea', 'codex', 'gpt-5.5')]);

    answers[0]?.(SETTINGS);
    await first;
    await vi.waitFor(() => expect(command).toHaveBeenCalledTimes(3));
    expect(command.mock.calls[2]).toEqual(patch('code', 'claude-code', 'claude-opus-5-5'));
    answers[1]?.(SETTINGS);
    answers[2]?.(SETTINGS);
    await Promise.all([last, other]);
  });

  it('sends the next choice of a row even when the one before was refused', async () => {
    let calls = 0;
    const { roles, command } = setup(async () => {
      calls += 1;
      if (calls === 1) throw refused(422, 'settings.engine-unusable', 'Ce modèle n’est pas utilisable sur ton Runner.');
      return SETTINGS;
    });
    const first = roles.choose('code', { engine: 'codex', model: 'gpt-5.5' });
    const last = roles.choose('code', { engine: 'claude-code', model: 'claude-opus-5-5' });
    await Promise.all([first, last]);
    expect(command).toHaveBeenCalledTimes(2);
    expect(roles.view().errors).toEqual({});
  });
});
