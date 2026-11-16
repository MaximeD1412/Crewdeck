/// <reference types="vite/client" />
import './tokens.css';
import { COMPOSANTS, t, type ComposantData, type RoleSettings } from '@crewdeck/sdk';
import { actionsOf, defineSkin, inside, render, settle, textOf } from './testing/dom.js';

beforeAll(defineSkin);
afterEach(() => document.body.replaceChildren());

type Data = ComposantData<typeof RoleSettings>;
type WithData = HTMLElement & { data: Record<string, unknown> };

const [yours, unusable, adding, none] = COMPOSANTS.RoleSettings.examples.map((example) => example.data as Data);
if (!yours || !unusable || !adding || !none) throw new Error('RoleSettings lacks its examples');

const roleSettings = (data: Data) => render(COMPOSANTS.RoleSettings, data);
const all = (el: Element, selector: string) => [...(el.shadowRoot?.querySelectorAll<WithData>(selector) ?? [])];
const select = (el: Element, roleId: string) => inside<WithData>(el, `cd-setting-row[data-role="${roleId}"] cd-select`);
const optionLabels = (el: WithData) => (el.data['options'] as { label: string }[]).map((option) => option.label);
const OPUS = 'claude-code:claude-opus-5-5';
const SONNET = 'claude-code:claude-sonnet-5-5';
const GPT = 'codex:gpt-5.5';
/** Picks `value` in `control`'s native select, as the Pilote does. */
const choose = (control: Element, value: string) => {
  const native = inside<HTMLSelectElement>(control, 'select');
  native.value = value;
  native.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  native.dispatchEvent(new Event('change', { bubbles: true }));
};
const pick = (el: Element, roleId: string, value: string) => choose(select(el, roleId), value);
const pickModel = (el: Element, value: string) => choose(inside(el, 'cd-select.model'), value);
const withRole = (data: Data, roleId: string, change: Partial<Data['roles'][number]>): Data => ({
  ...data,
  roles: data.roles.map((role) => (role.id === roleId ? { ...role, ...change } : role)),
});
const type = (el: Element, name: string) => {
  const field = inside<HTMLInputElement>(el, 'cd-text-field.name', 'input');
  field.value = name;
  field.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  return field;
};
const reopen = async (el: Element & { data: unknown }, data: Data) => {
  el.data = data;
  await settle(el);
};

describe('RoleSettings', () => {
  it('shows the card « Rôles et modèles », a row per Rôle with its help and its model, « Retirer » only on the Pilote’s', async () => {
    const el = await roleSettings(yours);
    expect(inside<WithData>(el, 'cd-card').data).toEqual({ title: 'Rôles et modèles', label: 'Paramètres / Rôles et modèles' });
    expect(all(el, 'cd-setting-row').map((row) => [row.data['label'], row.data['help']])).toEqual(yours.roles.map((role) => [role.name, role.help]));
    expect(select(el, 'review').data).toMatchObject({ label: 'Moteur et modèle du Rôle Review', value: 'codex:gpt-5.5', state: null });
    expect(optionLabels(select(el, 'review'))).toEqual(['Claude Code · Opus 5.5', 'Claude Code · Sonnet 5.5', 'Codex · GPT-5.5']);
    expect(inside<HTMLSelectElement>(select(el, 'idea'), 'select').selectedOptions[0]?.textContent?.trim()).toBe('Claude Code · Sonnet 5.5');
    expect(all(el, 'cd-button.remove').map((button) => button.closest('cd-setting-row')?.getAttribute('data-role'))).toEqual(['r-k3v9q2m7']);
    expect(inside<WithData>(el, 'cd-button.add').data).toEqual({ label: 'Ajouter un Rôle', variant: 'ghost', size: 'sm', icon: 'plus' });
    expect(inside(el, 'cd-button.add').slot).toBe('actions');
  });

  it('keeps a stored model no longer usable selected, first, with its error', async () => {
    const el = await roleSettings(unusable);
    expect(select(el, 'review').data).toMatchObject({ value: 'codex:gpt-5.5-pro', error: 'Quota atteint : choisis un autre modèle.' });
    expect(optionLabels(select(el, 'review'))).toEqual(['Codex · gpt-5.5-pro', 'Claude Code · Opus 5.5', 'Claude Code · Sonnet 5.5', 'Codex · GPT-5.5']);
    expect(textOf(inside(select(el, 'review'), '.error'))).toBe('Quota atteint : choisis un autre modèle.');
    expect(select(el, 'code').data['error']).toBeUndefined();
  });

  it('chooses a model with `choose`, nothing for the one already chosen; the Select’s change stays inside', async () => {
    const el = await roleSettings(yours);
    const changes: Event[] = [];
    document.addEventListener('change', (event) => changes.push(event));
    expect(await actionsOf(() => pick(el, 'code', GPT))).toEqual([
      { composant: 'RoleSettings', action: 'choose', payload: { roleId: 'code', engine: 'codex', model: 'gpt-5.5' } },
    ]);
    expect(await actionsOf(() => pick(el, 'idea', SONNET))).toEqual([]);
    expect(changes.every((event) => event.target === el)).toBe(true);
  });

  it('removes a Rôle of the Pilote’s with `remove`', async () => {
    const el = await roleSettings(yours);
    expect(await actionsOf(() => inside(el, 'cd-button.remove', 'button').click())).toEqual([
      { composant: 'RoleSettings', action: 'remove', payload: { roleId: 'r-k3v9q2m7' } },
    ]);
  });

  it('without any usable model, offers none and adds none, saying why', async () => {
    const el = await roleSettings(none);
    expect(select(el, 'idea').data).toMatchObject({ value: '', state: 'disabled', options: [{ value: '', label: 'Aucun modèle utilisable', disabled: true }] });
    expect(inside<WithData>(el, 'cd-button.add').data).toMatchObject({ state: 'disabled', disabledReason: t('settings.roles.add.noModel') });
    expect(await actionsOf(() => inside(el, 'cd-button.add', 'button').click())).toEqual([]);
  });

  it('at 20 Rôles of the Pilote’s, adds no other', async () => {
    const custom = yours.roles.find((role) => role.removable);
    if (!custom) throw new Error('no Rôle of the Pilote’s');
    const many = Array.from({ length: 20 }, (_, i) => ({ ...custom, id: `r-${String(i).padStart(8, '0')}`, name: `Rôle ${i}` }));
    const el = await roleSettings({ ...yours, roles: [...yours.roles.filter((role) => !role.removable), ...many] });
    expect(inside<WithData>(el, 'cd-button.add').data).toMatchObject({ state: 'disabled', disabledReason: '20 Rôles au plus.' });
  });

  it('asks to open « Nouveau Rôle » with `add`; the Dialog stays closed until the core opens it', async () => {
    const el = await roleSettings(yours);
    expect(inside<WithData>(el, 'cd-dialog').data).toEqual({ open: false, title: 'Nouveau Rôle' });
    expect(el.shadowRoot?.querySelector('cd-text-field')).toBeNull();
    expect(await actionsOf(() => inside(el, 'cd-button.add', 'button').click())).toEqual([{ composant: 'RoleSettings', action: 'add', payload: {} }]);
  });

  it('in « Nouveau Rôle », a name and a model; « Ajouter » and Enter create, the name’s error under it', async () => {
    const el = await roleSettings(adding);
    expect(inside<WithData>(el, 'cd-dialog').data).toEqual({ open: true, title: 'Nouveau Rôle' });
    expect(inside<WithData>(el, 'cd-text-field.name').data).toMatchObject({
      label: 'Nom',
      placeholder: 'Revue Gemini',
      maxLength: 40,
      error: 'Un Rôle porte déjà ce nom.',
    });
    expect(inside<WithData>(el, 'cd-select.model').data).toMatchObject({ label: 'Moteur et modèle', value: OPUS });
    const field = type(el, 'Revue Codex');
    pickModel(el, GPT);
    const created = { composant: 'RoleSettings', action: 'create', payload: { name: 'Revue Codex', engine: 'codex', model: 'gpt-5.5' } };
    expect(await actionsOf(() => inside(el, 'cd-button.create', 'button').click())).toEqual([created]);
    expect(await actionsOf(() => field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, composed: true })))).toEqual([created]);
  });

  it('while the command is on its way, « Ajouter » waits and nothing closes', async () => {
    const el = await roleSettings({ ...adding, adding: { ...adding.adding, busy: true } });
    expect(inside<WithData>(el, 'cd-button.create').data).toMatchObject({ state: 'loading' });
    expect(await actionsOf(() => inside(el, 'cd-button.create', 'button').click())).toEqual([]);
    expect(await actionsOf(() => inside(el, 'cd-button.cancel', 'button').click())).toEqual([]);
  });

  it('« Annuler » and the Dialog’s close cancel, the Dialog’s own action staying inside', async () => {
    const el = await roleSettings(adding);
    const cancelled = [{ composant: 'RoleSettings', action: 'cancel', payload: {} }];
    expect(await actionsOf(() => inside(el, 'cd-button.cancel', 'button').click())).toEqual(cancelled);
    expect(await actionsOf(() => inside(el, 'cd-dialog', 'cd-icon-button', 'button').click())).toEqual(cancelled);
  });

  it('gives new fields at each opening', async () => {
    const el = await roleSettings(adding);
    type(el, 'Revue Codex');
    await reopen(el, yours);
    await reopen(el, { ...adding, adding: { ...adding.adding, nameError: null } });
    expect(inside<HTMLInputElement>(el, 'cd-text-field.name', 'input').value).toBe('');
  });

  it('keeps the model picked in « Nouveau Rôle » when the usable models change; gone, asks for another and creates nothing', async () => {
    const el = await roleSettings({ ...adding, adding: { ...adding.adding, nameError: null } });
    type(el, 'Revue Sonnet');
    pickModel(el, SONNET);
    const [opus, sonnet, gpt] = adding.models;
    if (!opus || !sonnet || !gpt) throw new Error('three models');
    await reopen(el, { ...adding, models: [sonnet, gpt], adding: { ...adding.adding, nameError: null } });
    expect(inside<WithData>(el, 'cd-select.model').data).toMatchObject({ value: SONNET });
    expect(await actionsOf(() => inside(el, 'cd-button.create', 'button').click())).toEqual([
      { composant: 'RoleSettings', action: 'create', payload: { name: 'Revue Sonnet', engine: 'claude-code', model: 'claude-sonnet-5-5' } },
    ]);

    await reopen(el, { ...adding, models: [opus, gpt], adding: { ...adding.adding, nameError: null } });
    expect(inside<WithData>(el, 'cd-select.model').data).toMatchObject({ value: '', error: 'Ce modèle n’est plus utilisable : choisis-en un autre.' });
    expect(optionLabels(inside<WithData>(el, 'cd-select.model'))).toEqual(['Choisis un modèle', 'Claude Code · Opus 5.5', 'Codex · GPT-5.5']);
    expect(await actionsOf(() => inside(el, 'cd-button.create', 'button').click())).toEqual([]);
    pickModel(el, GPT);
    expect(await actionsOf(() => inside(el, 'cd-button.create', 'button').click())).toEqual([
      { composant: 'RoleSettings', action: 'create', payload: { name: 'Revue Sonnet', engine: 'codex', model: 'gpt-5.5' } },
    ]);
  });

  it('sends the model picked back while another is on its way, and shows the last pick until the store has it', async () => {
    const el = await roleSettings(yours);
    const chosen = (engine: string, model: string) => ({ composant: 'RoleSettings', action: 'choose', payload: { roleId: 'code', engine, model } });
    expect(await actionsOf(() => pick(el, 'code', GPT))).toEqual([chosen('codex', 'gpt-5.5')]);
    expect(await actionsOf(() => pick(el, 'code', OPUS))).toEqual([chosen('claude-code', 'claude-opus-5-5')]);

    // The first choice reaches the store: the row keeps showing the last one.
    const gpt = { engine: 'codex' as const, model: 'gpt-5.5', label: 'Codex · GPT-5.5' };
    await reopen(el, withRole(yours, 'code', { choice: gpt }));
    expect(select(el, 'code').data['value']).toBe(OPUS);
    expect(inside<HTMLSelectElement>(select(el, 'code'), 'select').value).toBe(OPUS);
    expect(await actionsOf(() => pick(el, 'code', OPUS))).toEqual([]);

    // The last one does: nothing on its way any more.
    await reopen(el, yours);
    expect(await actionsOf(() => pick(el, 'code', OPUS))).toEqual([]);
  });

  it('shows the stored model again once the row is refused, a new pick of the refused one sent again', async () => {
    const el = await roleSettings(yours);
    await actionsOf(() => pick(el, 'code', GPT));
    await reopen(el, withRole(yours, 'code', { error: 'Ce modèle n’est pas utilisable sur ton Runner.' }));
    expect(select(el, 'code').data['value']).toBe(OPUS);
    expect(inside<HTMLSelectElement>(select(el, 'code'), 'select').value).toBe(OPUS);
    expect(await actionsOf(() => pick(el, 'code', GPT))).toEqual([
      { composant: 'RoleSettings', action: 'choose', payload: { roleId: 'code', engine: 'codex', model: 'gpt-5.5' } },
    ]);
  });
});
