import { PROCESS_CREWDECK, PROCESS_CREWDECK_NAME, processSealAad, templateSealAad, type ProcessTemplate, type ProjectProcess } from '@crewdeck/contracts';
import type { Client } from './api/client.js';
import { ApiError } from './api/request.js';
import { createEditorUi } from './process/editor-ui.js';
import { createSaveTemplate, createTemplateList, NO_TEMPLATE_LIST_LOCAL, type TemplatesStore } from './process-templates.js';
import { fakeSealed, fakeVault } from './projects/testing.js';

const PROJECT = '019a6f00-0000-7000-8000-000000000011';
const WEB = '019a6f00-0000-7000-8000-0000000000a1';
const COMMANDS = JSON.stringify({ e2e: 'pnpm exec playwright test' });
const AT = '2026-11-12T10:00:00.000Z';

const template = (id: string, name: string): ProcessTemplate => ({
  id,
  name,
  fromProjectId: PROJECT,
  fromVersionNumber: 3,
  sealed: null,
  commandCount: 0,
  revision: 1,
  createdAt: AT,
  updatedAt: AT,
});

const processWith = (sealed: ProjectProcess['active'] extends infer A ? (A extends { sealed: infer S } ? S : never) : never): ProjectProcess => ({
  id: PROJECT,
  active: { number: 3, definition: PROCESS_CREWDECK, sealed, activatedAt: AT, activatedBy: 'pilot', templateName: PROCESS_CREWDECK_NAME },
  draft: null,
  sources: { ticket: { source: 'github', since: AT }, code: { source: 'github', since: AT } },
  running: [],
});

const refused = (status: number, code: string, message: string, fields?: Record<string, string>) =>
  new ApiError({ status, code, message, ...(fields ? { fields } : {}) });

const setup = (store: TemplatesStore, answer: (...args: unknown[]) => Promise<unknown> = async (_method, _path, body) => ({ ...template(WEB, ''), ...(body as object) })) => {
  const command = vi.fn<(...args: unknown[]) => Promise<unknown>>(answer);
  const ui = createEditorUi();
  const vault = fakeVault();
  const save = createSaveTemplate({ ui, client: { command: command as unknown as Client['command'] }, vault, slices: () => store, projectId: () => PROJECT });
  const shown = () => ui.view(PROJECT, {});
  return { save, command, shown, vault };
};

describe('createSaveTemplate', () => {
  it('opens on the default name and closes', () => {
    const { save, shown } = setup({ process: new Map([[PROJECT, processWith(null)]]) });
    save.open();
    expect(shown().saveTemplate).toEqual({ name: null, error: null, replaceId: null });
    save.close();
    expect(shown().saveTemplate).toBeNull();
  });

  it('saves the active version under a new id, its Commandes sealed again under template:<id>, then closes on a go Toast', async () => {
    const sealed = await fakeSealed(COMMANDS, processSealAad(PROJECT));
    const { save, command, shown } = setup({ process: new Map([[PROJECT, processWith(sealed)]]) });
    save.open();
    await save.save({ name: 'Process Site mairie' });

    expect(command).toHaveBeenCalledTimes(1);
    const [method, path, body] = command.mock.calls[0] ?? [];
    expect([method, path]).toEqual(['POST', '/api/process-templates']);
    const { id } = body as { id: string };
    expect(body).toEqual({
      id,
      name: 'Process Site mairie',
      projectId: PROJECT,
      versionNumber: 3,
      sealed: await fakeSealed(COMMANDS, templateSealAad(id)),
      vaultKeyVersion: 1,
      replace: false,
    });
    expect(shown().saveTemplate).toBeNull();
    expect(shown().toast).toEqual({ tone: 'go', icon: 'check', text: 'Modèle de process « Process Site mairie » enregistré.' });
  });

  it('refuses a name taken first, offering to replace that Modèle, then replaces it under its own id', async () => {
    const { save, command, shown } = setup({
      process: new Map([[PROJECT, processWith(null)]]),
      'process-template': new Map([[WEB, template(WEB, 'Process web')]]),
    });
    save.open();
    await save.save({ name: ' process WEB' });
    expect(command).not.toHaveBeenCalled();
    expect(shown().saveTemplate).toEqual({ name: ' process WEB', error: 'Un Modèle de process porte déjà ce nom.', replaceId: WEB });

    await save.save({ name: ' process WEB' });
    expect(command).toHaveBeenCalledWith(
      'POST',
      '/api/process-templates',
      { id: WEB, name: ' process WEB', projectId: PROJECT, versionNumber: 3, sealed: null, replace: true },
      expect.anything(),
    );
    expect(shown().saveTemplate).toBeNull();
  });

  it('replaces only the name it refused: another case or other spaces are refused again, unsent', async () => {
    const { save, command, shown } = setup({
      process: new Map([[PROJECT, processWith(null)]]),
      'process-template': new Map([[WEB, template(WEB, 'Process web')]]),
    });
    save.open();
    await save.save({ name: 'process web' });
    expect(shown().saveTemplate).toMatchObject({ name: 'process web', replaceId: WEB });

    // « Enregistrer » again, not « Remplacer »: the Skin compares the name exactly, and so does the save.
    for (const name of ['Process web', 'process web ', '  process web']) {
      await save.save({ name });
      expect(command).not.toHaveBeenCalled();
      expect(shown().saveTemplate).toEqual({ name, error: 'Un Modèle de process porte déjà ce nom.', replaceId: WEB });
    }

    await save.save({ name: '  process web' });
    expect(command).toHaveBeenCalledTimes(1);
    expect(command.mock.calls[0]?.[2]).toMatchObject({ id: WEB, name: '  process web', replace: true });
  });

  it('after a rotation, unlocks the vault and seals the Commandes again under its new version, once (E2E-4)', async () => {
    const sealed = await fakeSealed(COMMANDS, processSealAad(PROJECT));
    let refusals = 1;
    const { save, command, shown, vault } = setup({ process: new Map([[PROJECT, processWith(sealed)]]) }, async (_method, _path, body) => {
      if (refusals-- > 0) {
        // Another holder rotated between the sealing and the write.
        vault.version = 2;
        throw refused(409, 'vault.version-changed', 'La clé du coffre a déjà changé : relis le coffre avant de recommencer.');
      }
      return { ...template(WEB, ''), ...(body as object) };
    });
    save.open();
    await save.save({ name: 'Process Site mairie' });

    expect(vault.unlocks).toBe(1);
    const bodies = command.mock.calls.map(([, , body]) => body as { id: string; vaultKeyVersion: number });
    expect(bodies.map((body) => body.vaultKeyVersion)).toEqual([1, 2]);
    expect(bodies[1]?.id).toBe(bodies[0]?.id);
    expect(shown().saveTemplate).toBeNull();
  });

  it('says the server’s refusal under the name: a version activated meanwhile, « Process Crewdeck »', async () => {
    const stale = refused(409, 'process.version-stale', 'La version active a changé : enregistre à nouveau.');
    const { save, shown } = setup({ process: new Map([[PROJECT, processWith(null)]]) }, () => Promise.reject(stale));
    save.open();
    await save.save({ name: 'Process mairie' });
    expect(shown().saveTemplate).toEqual({ name: 'Process mairie', error: 'La version active a changé : enregistre à nouveau.', replaceId: null });

    const reserved = refused(422, 'process-template.name-reserved', 'Refusé.', { name: 'Ce nom est celui du Modèle de Crewdeck.' });
    const other = setup({ process: new Map([[PROJECT, processWith(null)]]) }, () => Promise.reject(reserved));
    other.save.open();
    await other.save.save({ name: 'Process Crewdeck' });
    expect(other.shown().saveTemplate?.error).toBe('Ce nom est celui du Modèle de Crewdeck.');
  });

  it('offers to replace a Modèle the server knows by that name before the store does', async () => {
    const store: { process: Map<string, ProjectProcess>; 'process-template': Map<string, ProcessTemplate> } = {
      process: new Map([[PROJECT, processWith(null)]]),
      'process-template': new Map(),
    };
    const { save, shown } = setup(store, () => {
      store['process-template'].set(WEB, template(WEB, 'Process web'));
      return Promise.reject(refused(409, 'process-template.name-taken', 'Un Modèle de process porte déjà ce nom.', { name: 'Un Modèle de process porte déjà ce nom.' }));
    });
    save.open();
    await save.save({ name: 'Process web' });
    expect(shown().saveTemplate).toEqual({ name: 'Process web', error: 'Un Modèle de process porte déjà ce nom.', replaceId: WEB });
  });
});

describe('createTemplateList', () => {
  const OTHER = '019a6f00-0000-7000-8000-0000000000a2';
  const list = (answer: () => Promise<unknown> = async () => undefined) => {
    const command = vi.fn<(...args: unknown[]) => Promise<unknown>>(answer);
    const templates = new Map([
      [WEB, template(WEB, 'Process web')],
      [OTHER, template(OTHER, 'Process atelier')],
    ]);
    const changes = vi.fn<() => void>();
    const state = createTemplateList({ client: { command: command as unknown as Client['command'] }, templates: () => templates });
    state.subscribe(changes);
    return { state, command, changes };
  };

  it('renames in its Dialog with PATCH, then closes', async () => {
    const { state, command, changes } = list();
    state.rename(WEB);
    expect(state.view()).toEqual({ renaming: { id: WEB, name: 'Process web', error: null }, removing: null });
    await state.submitRename(WEB, 'Process web 2');
    expect(command).toHaveBeenCalledWith('PATCH', `/api/process-templates/${WEB}`, { name: 'Process web 2' }, expect.anything());
    expect(state.view()).toEqual(NO_TEMPLATE_LIST_LOCAL);
    expect(changes).toHaveBeenCalledTimes(2);
  });

  it('keeps the Dialog open on a name taken, its reason under the name; the same name closes it unsent', async () => {
    const taken = refused(409, 'process-template.name-taken', 'Refusé.', { name: 'Un Modèle de process porte déjà ce nom.' });
    const { state, command } = list(() => Promise.reject(taken));
    state.rename(WEB);
    await state.submitRename(WEB, 'Process atelier');
    expect(state.view().renaming).toEqual({ id: WEB, name: 'Process atelier', error: 'Un Modèle de process porte déjà ce nom.' });
    command.mockClear();
    await state.submitRename(WEB, 'Process web');
    expect(command).not.toHaveBeenCalled();
    expect(state.view()).toEqual(NO_TEMPLATE_LIST_LOCAL);
  });

  it('asks before removing, then removes with DELETE; one already gone is what was asked', async () => {
    const { state, command } = list();
    state.remove(OTHER);
    expect(state.view()).toEqual({ renaming: null, removing: { id: OTHER, name: 'Process atelier' } });
    await state.confirmRemove(OTHER);
    expect(command).toHaveBeenCalledWith('DELETE', `/api/process-templates/${OTHER}`, {});
    expect(state.view()).toEqual(NO_TEMPLATE_LIST_LOCAL);

    const gone = list(() => Promise.reject(refused(404, 'process-template.not-found', 'Ce Modèle de process n’existe plus.')));
    gone.state.remove(OTHER);
    await expect(gone.state.confirmRemove(OTHER)).resolves.toBeUndefined();
  });

  it('cancels either Dialog', () => {
    const { state } = list();
    state.remove(WEB);
    state.cancel();
    expect(state.view()).toEqual(NO_TEMPLATE_LIST_LOCAL);
  });
});
