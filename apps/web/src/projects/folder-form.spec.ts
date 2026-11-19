import type { FolderCheckResult, Project } from '@crewdeck/contracts';
import { createFolderChecker, FOLDER_CHECK_DEBOUNCE_MS, type FolderCheckOutcome } from './folder-check.js';
import { createFolderForm } from './folder-form.js';

const ID = '019a6f00-0000-7000-8000-000000000021';
const READY: FolderCheckResult = { state: 'ready', hasCode: true, branch: 'main', name: 'recettes' };
const PROJECT = { id: ID } as Project;
const CONTEXT = { context: 'projets', vaultLocked: false, machine: 'atelier-pc' } as const;

const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

const setup = (outcome: (path: string) => FolderCheckOutcome = () => READY) => {
  const checker = createFolderChecker({ check: async (path) => outcome(path) });
  let release: () => void = () => undefined;
  const createProject = vi.fn(() => new Promise<Project>((resolve) => (release = () => resolve(PROJECT))));
  const attachFolder = vi.fn(async () => PROJECT);
  const form = createFolderForm({ checker, createProject, attachFolder });
  const typed = async (path: string) => {
    form.checkPath(path);
    await vi.advanceTimersByTimeAsync(FOLDER_CHECK_DEBOUNCE_MS);
    await flush();
  };
  return { form, createProject, attachFolder, typed, release: () => release() };
};

describe('createFolderForm', () => {
  it('shows the typed path, its check and the folder’s name, with « Process Crewdeck »', async () => {
    const { form, typed } = setup();
    expect(form.view(CONTEXT)).toMatchObject({ path: '', check: { state: 'idle' }, name: '', busy: false, templateId: 'process-crewdeck' });

    await typed('~/projets/recettes');

    expect(form.view(CONTEXT)).toEqual({
      context: 'projets',
      path: '~/projets/recettes',
      check: { state: 'ready', hasCode: true },
      name: 'recettes',
      templates: [{ id: 'process-crewdeck', label: 'Process Crewdeck' }],
      templateId: 'process-crewdeck',
      busy: false,
      vaultLocked: false,
      machine: 'atelier-pc',
    });
    expect(form.view({ ...CONTEXT, context: 'repick', name: 'Recettes' }).name).toBe('Recettes');
  });

  it('creates the Projet from the folder checked, busy meanwhile, then forgets the path', async () => {
    const { form, createProject, typed, release } = setup();
    await typed('~/projets/recettes');

    const creating = form.create({ path: '~/projets/recettes', name: ' Recettes ', templateId: 'process-crewdeck' });
    expect(form.view(CONTEXT).busy).toBe(true);
    await expect(form.create({ path: '~/projets/recettes', name: 'Recettes', templateId: 'process-crewdeck' })).resolves.toBeNull();
    release();

    await expect(creating).resolves.toBe(PROJECT);
    expect(createProject.mock.calls).toEqual([[{ path: '~/projets/recettes', name: 'Recettes', templateId: 'process-crewdeck', check: READY }]]);
    expect(form.view(CONTEXT)).toMatchObject({ path: '', check: { state: 'idle' }, busy: false });
  });

  it('creates nothing from a path not checked yet, another one, or a folder missing; a folder without git is fine', async () => {
    const { form, createProject, typed, release } = setup((path) => (path.endsWith('recetes') ? { ...READY, state: 'missing' } : path.endsWith('notes') ? { ...READY, state: 'not-git', branch: null } : READY));
    form.checkPath('~/projets/recettes');
    expect(await form.create({ path: '~/projets/recettes', name: 'Recettes', templateId: 'process-crewdeck' })).toBeNull();
    await typed('~/projets/recettes');
    expect(await form.create({ path: '~/projets/autre', name: 'Recettes', templateId: 'process-crewdeck' })).toBeNull();
    await typed('~/projets/recetes');
    expect(await form.create({ path: '~/projets/recetes', name: 'Recettes', templateId: 'process-crewdeck' })).toBeNull();
    expect(createProject).not.toHaveBeenCalled();

    await typed('~/notes');
    const creating = form.create({ path: '~/notes', name: 'Notes', templateId: 'process-crewdeck' });
    release();
    await expect(creating).resolves.toBe(PROJECT);
  });

  it('a refusal is thrown, the form no longer busy and its path kept', async () => {
    const { form, createProject, typed } = setup();
    createProject.mockImplementationOnce(() => Promise.reject(new Error('refused')));
    await typed('~/projets/recettes');

    await expect(form.create({ path: '~/projets/recettes', name: 'Recettes', templateId: 'process-crewdeck' })).rejects.toThrow('refused');
    expect(form.view(CONTEXT)).toMatchObject({ path: '~/projets/recettes', check: { state: 'ready' }, busy: false });
  });

  it('chooses a Projet’s folder again once the Runner found it', async () => {
    const { form, attachFolder, typed } = setup();
    expect(await form.attach(ID, '~/projets/recettes')).toBeNull();
    await typed('~/projets/recettes');

    await expect(form.attach(ID, '~/projets/recettes')).resolves.toBe(PROJECT);
    expect(attachFolder.mock.calls).toEqual([[ID, '~/projets/recettes']]);
  });
});
