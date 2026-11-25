/// <reference types="vite/client" />
import './tokens.css';
import { COMPOSANTS, type ComposantData, type ProcessTemplateList } from '@crewdeck/sdk';
import { actionsOf, defineSkin, inside, render, settle, textOf } from './testing/dom.js';

beforeAll(defineSkin);
afterEach(() => document.body.replaceChildren());

type Data = ComposantData<typeof ProcessTemplateList>;
type WithData = HTMLElement & { data: Record<string, unknown> };

const [yours, none, renaming, removing] = COMPOSANTS.ProcessTemplateList.examples.map((example) => example.data as Data);
if (!yours || !none || !renaming || !removing) throw new Error('ProcessTemplateList lacks its examples');
const [mairie, atelier] = yours.templates;
if (!mairie || !atelier) throw new Error('two Modèles');

const list = (data: Data) => render(COMPOSANTS.ProcessTemplateList, data);
const all = (el: Element, selector: string) => [...(el.shadowRoot?.querySelectorAll<WithData>(selector) ?? [])];
const inRow = (id: string, selector: string) => `cd-list-row[data-template="${id}"] ${selector}`;
const click = (el: Element, ...path: string[]) => actionsOf(() => inside(el, ...path, 'button').click());
const dialog = (el: Element, name: string) => inside<WithData>(el, `cd-dialog.${name}`);
const action = (name: string, payload: object) => ({ composant: 'ProcessTemplateList', action: name, payload });

describe('ProcessTemplateList', () => {
  it('shows the card « Modèles de process » with its count, a row per Modèle with its meta, « Renommer » and « Supprimer »', async () => {
    const el = await list(yours);
    expect(inside<WithData>(el, 'cd-card').data).toEqual({ title: 'Modèles de process', count: 2, label: 'Paramètres / Modèles de process', flush: true });
    expect(all(el, 'cd-list-row').map((item) => item.data)).toEqual([
      { title: 'Process Site mairie', meta: 'depuis Site mairie · 12 nov.', icon: 'layers' },
      { title: 'Process atelier', meta: 'depuis un Projet supprimé · 3 nov.', icon: 'layers' },
    ]);
    expect(inside<WithData>(el, inRow(mairie.id, 'cd-button.rename')).data).toEqual({ label: 'Renommer', variant: 'ghost', size: 'sm' });
    expect(inside<WithData>(el, inRow(mairie.id, 'cd-button.remove')).data).toEqual({ label: 'Supprimer', variant: 'ghost', size: 'sm', icon: 'trash' });
    expect(inside(el, inRow(mairie.id, 'cd-button.rename')).closest('[slot]')?.getAttribute('slot')).toBe('trailing');
    expect(dialog(el, 'renaming').data['open']).toBe(false);
    expect(dialog(el, 'removing').data['open']).toBe(false);
  });

  it('shows its Empty without any Modèle', async () => {
    const el = await list(none);
    expect(inside<WithData>(el, 'cd-card').data).toMatchObject({ count: 0 });
    expect(all(el, 'cd-list-row')).toEqual([]);
    expect(inside<WithData>(el, 'cd-empty').data).toEqual({ icon: 'layers', title: 'Aucun Modèle de process' });
    expect(textOf(inside(el, 'cd-empty'))).toBe(
      'Enregistre le Process d’un Projet depuis sa Gestion du process : tes prochains Projets pourront partir de lui.',
    );
  });

  it('asks to rename or remove a Modèle by its id', async () => {
    const el = await list(yours);
    expect(await click(el, inRow(atelier.id, 'cd-button.rename'))).toEqual([action('rename', { id: atelier.id })]);
    expect(await click(el, inRow(mairie.id, 'cd-button.remove'))).toEqual([action('remove', { id: mairie.id })]);
  });

  it('renames in its Dialog, with the server’s error under the name; Enter submits, « Annuler » cancels', async () => {
    const el = await list(renaming);
    expect(dialog(el, 'renaming').data).toEqual({ open: true, title: 'Renommer le Modèle de process' });
    expect(inside<WithData>(el, 'cd-text-field.name').data).toMatchObject({
      label: 'Nom du Modèle de process',
      value: 'Process atelier',
      error: 'Un Modèle de process porte déjà ce nom.',
    });
    expect(inside<WithData>(el, 'cd-button.submit-rename').data).toMatchObject({ label: 'Renommer', variant: 'primary' });

    const field = inside<HTMLInputElement>(el, 'cd-text-field.name', 'input');
    field.value = 'Process mairie 2';
    field.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    expect(await click(el, 'cd-button.submit-rename')).toEqual([action('submitRename', { id: mairie.id, name: 'Process mairie 2' })]);
    expect(
      await actionsOf(() => field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, composed: true }))),
    ).toEqual([action('submitRename', { id: mairie.id, name: 'Process mairie 2' })]);
    expect(await click(el, 'cd-dialog.renaming cd-button.cancel')).toEqual([action('cancel', {})]);
  });

  it('asks before removing, then removes; « Annuler » and the Dialog’s close cancel', async () => {
    const el = await list(removing);
    expect(dialog(el, 'removing').data).toEqual({ open: true, title: 'Supprimer le Modèle de process « Process atelier » ?' });
    expect(textOf(inside(el, 'cd-dialog.removing p'))).toBe('Les Projets partis de lui gardent leur Process.');
    expect(inside<WithData>(el, 'cd-button.confirm-remove').data).toMatchObject({ label: 'Supprimer', variant: 'danger' });
    expect(await click(el, 'cd-button.confirm-remove')).toEqual([action('confirmRemove', { id: atelier.id })]);
    expect(await click(el, 'cd-dialog.removing cd-button.cancel')).toEqual([action('cancel', {})]);
    expect(await click(el, 'cd-dialog.removing', 'cd-icon-button')).toEqual([action('cancel', {})]);
    el.data = { ...removing, removing: null };
    await settle(el);
    expect(dialog(el, 'removing').data['open']).toBe(false);
  });
});
