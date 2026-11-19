/// <reference types="vite/client" />
import './tokens.css';
import { COMPOSANTS, FolderProjectForm, type ComposantData } from '@crewdeck/sdk';
import { actionsOf, defineSkin, inside, render, settle } from './testing/dom.js';

beforeAll(defineSkin);
afterEach(() => document.body.replaceChildren());

type Data = ComposantData<typeof FolderProjectForm>;
type WithData = HTMLElement & { data: Record<string, unknown> };

const READY: Data = {
  context: 'projets',
  path: '~/projets/recettes',
  check: { state: 'ready', hasCode: true },
  name: 'recettes',
  templates: [
    { id: 'process-crewdeck', label: 'Process Crewdeck' },
    { id: 'process-court', label: 'Process court' },
  ],
  templateId: 'process-crewdeck',
  busy: false,
  vaultLocked: false,
  machine: 'atelier-pc',
};

const form = (data: Data) => render(COMPOSANTS.FolderProjectForm, data);
const child = (el: Element, selector: string) => inside<WithData>(el, selector);
const update = async (el: Element, data: Data) => {
  (el as unknown as { data: Data }).data = data;
  await settle(el);
};
const type = async (el: Element, field: 'path' | 'name', value: string) => {
  const input = inside<HTMLInputElement>(el, `cd-text-field.${field}`, 'input');
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  await settle(el);
};
const create = (el: Element) => inside(el, 'cd-button.create', 'button').click();
const valid = (details: { action: string; payload: unknown }[]) =>
  details.every(({ action, payload }) => FolderProjectForm.actions[action as keyof typeof FolderProjectForm.actions].safeParse(payload).success);

describe('FolderProjectForm', () => {
  it('« Chemin du dossier », « Nom du Projet » filled with the folder’s name, the Select « Modèle de process »', async () => {
    const el = await form(READY);
    expect(child(el, 'cd-text-field.path').data).toMatchObject({ label: 'Chemin du dossier', value: '~/projets/recettes', placeholder: '~/projets/recettes' });
    expect(child(el, 'cd-text-field.name').data).toMatchObject({ label: 'Nom du Projet', value: 'recettes' });
    expect(child(el, 'cd-select.template').data).toMatchObject({
      label: 'Modèle de process',
      value: 'process-crewdeck',
      options: [
        { value: 'process-crewdeck', label: 'Process Crewdeck', disabled: false },
        { value: 'process-court', label: 'Process court', disabled: false },
      ],
    });
    expect(child(el, 'cd-button.create').data).toMatchObject({ label: 'Créer le Projet', variant: 'primary' });
    expect(el.shadowRoot?.querySelector('cd-button.later')).toBeNull();
  });

  it.each([
    ['idle', false, 'help', 'Le chemin complet d’un dossier sur atelier-pc, depuis / ou ~.'],
    ['checking', false, 'help', 'Vérification sur atelier-pc…'],
    ['ready', true, 'help', 'Dépôt git · déjà du code : un inventaire sera proposé.'],
    ['ready', false, 'help', 'Dépôt git · vide.'],
    ['not-git', true, 'help', 'Pas encore un dépôt git : Crewdeck proposera git init.'],
    ['missing', false, 'error', 'Dossier introuvable sur atelier-pc.'],
    ['not-absolute', false, 'error', 'Un chemin complet, depuis / ou ~.'],
    ['not-a-folder', false, 'error', 'Ce chemin n’est pas un dossier.'],
    ['taken', false, 'error', 'Ce dossier est déjà celui d’un autre Projet.'],
    ['runner-offline', false, 'error', 'Ton Runner est hors ligne : démarre-le pour choisir un dossier.'],
    ['timeout', false, 'error', 'Le Runner ne répond pas, réessaie.'],
  ] as const)('the check %s (code: %s) is the path’s %s « %s »', async (state, hasCode, where, line) => {
    const el = await form({ ...READY, check: { state, hasCode } });
    const other = where === 'help' ? 'error' : 'help';
    expect(child(el, 'cd-text-field.path').data).toMatchObject({ [where]: line, [other]: null });
  });

  it('without the Runner’s machine, says « ta machine »', async () => {
    const el = await form({ ...READY, check: { state: 'missing', hasCode: false }, machine: null });
    expect(child(el, 'cd-text-field.path').data['error']).toBe('Dossier introuvable sur ta machine.');
  });

  it.each([
    ['ready', true],
    ['not-git', true],
    ['idle', false],
    ['checking', false],
    ['missing', false],
    ['not-absolute', false],
    ['not-a-folder', false],
    ['taken', false],
    ['runner-offline', false],
    ['timeout', false],
  ] as const)('« Créer le Projet » on %s: enabled %s', async (state, enabled) => {
    const el = await form({ ...READY, check: { state, hasCode: false } });
    if (enabled) expect(child(el, 'cd-button.create').data).not.toHaveProperty('state');
    else expect(child(el, 'cd-button.create').data).toMatchObject({ state: 'disabled' });
    expect(await actionsOf(() => create(el))).toHaveLength(enabled ? 1 : 0);
  });

  it('« Créer le Projet » is disabled without a name, while the vault is locked (saying why), and loading while busy', async () => {
    const noName = await form({ ...READY, name: '' });
    expect(child(noName, 'cd-button.create').data).toMatchObject({ state: 'disabled' });
    expect(await actionsOf(() => create(noName))).toEqual([]);
    await type(noName, 'name', '   ');
    expect(await actionsOf(() => create(noName))).toEqual([]);

    const locked = await form({ ...READY, vaultLocked: true });
    expect(child(locked, 'cd-button.create').data).toMatchObject({
      state: 'disabled',
      disabledReason: 'Ouvre Crewdeck sur un Appareil de confiance pour créer un Projet local.',
    });
    expect(await actionsOf(() => create(locked))).toEqual([]);

    const busy = await form({ ...READY, busy: true });
    expect(child(busy, 'cd-button.create').data).toMatchObject({ state: 'loading' });
    expect(await actionsOf(() => inside(busy, 'cd-button.create').click())).toEqual([]);
  });

  it('each keystroke in the path emits checkPath with what is typed', async () => {
    const el = await form({ ...READY, path: '', check: { state: 'idle', hasCode: false }, name: '' });
    const details = await actionsOf(() => type(el, 'path', '~/projets/rec'));
    expect(details).toEqual([{ composant: 'FolderProjectForm', action: 'checkPath', payload: { path: '~/projets/rec' } }]);
    expect(valid(details)).toBe(true);
  });

  it('create sends the typed path, the name trimmed and the Modèle chosen', async () => {
    const el = await form({ ...READY, path: '', check: { state: 'idle', hasCode: false }, name: '' });
    await type(el, 'path', '~/projets/recettes');
    await update(el, { ...READY, path: '~/projets/recettes', check: { state: 'not-git', hasCode: false }, name: 'recettes' });
    await type(el, 'name', '  Mes recettes  ');
    const native = inside<HTMLSelectElement>(el, 'cd-select.template', 'select');
    native.value = 'process-court';
    native.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    const details = await actionsOf(() => create(el));
    expect(details).toEqual([
      { composant: 'FolderProjectForm', action: 'create', payload: { path: '~/projets/recettes', name: 'Mes recettes', templateId: 'process-court' } },
    ]);
    expect(valid(details)).toBe(true);
  });

  it('« Nom du Projet » follows the folder’s name until the Pilote types one, then keeps theirs', async () => {
    const el = await form({ ...READY, name: 'recettes' });
    await update(el, { ...READY, path: '~/projets/cuisine', name: 'cuisine' });
    expect(child(el, 'cd-text-field.name').data['value']).toBe('cuisine');
    await type(el, 'name', 'Livre de cuisine');
    await update(el, { ...READY, path: '~/projets/patisserie', name: 'patisserie' });
    expect(child(el, 'cd-text-field.name').data['value']).toBe('Livre de cuisine');
    expect((await actionsOf(() => create(el)))[0]?.payload).toMatchObject({ name: 'Livre de cuisine' });
  });

  it('in « Premiers pas », « Plus tard » emits later', async () => {
    const el = await form({ ...READY, context: 'demarrage' });
    expect(child(el, 'cd-button.later').data).toMatchObject({ label: 'Plus tard', variant: 'ghost' });
    expect(await actionsOf(() => inside(el, 'cd-button.later', 'button').click())).toEqual([{ composant: 'FolderProjectForm', action: 'later', payload: {} }]);
  });

  it('repick: the path only and « Relier ce dossier », with the Projet’s name', async () => {
    const el = await form({ ...READY, context: 'repick', name: 'Recettes' });
    expect(el.shadowRoot?.querySelector('cd-text-field.name, cd-select, cd-button.later')).toBeNull();
    expect(child(el, 'cd-button.create').data).toMatchObject({ label: 'Relier ce dossier' });
    const details = await actionsOf(() => create(el));
    expect(details).toEqual([
      { composant: 'FolderProjectForm', action: 'create', payload: { path: '~/projets/recettes', name: 'Recettes', templateId: 'process-crewdeck' } },
    ]);
    expect(valid(details)).toBe(true);
    const missing = await form({ ...READY, context: 'repick', name: 'Recettes', check: { state: 'missing', hasCode: false } });
    expect(child(missing, 'cd-button.create').data).toMatchObject({ state: 'disabled' });
  });
});
