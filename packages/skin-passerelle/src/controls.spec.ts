import { COMPOSANTS, t } from '@crewdeck/sdk';
import { page, userEvent } from 'vitest/browser';
import { deepActiveElement, inside, render, settle, textOf } from './testing/browser.js';

const select = {
  name: 'engine',
  label: 'Moteur',
  value: 'codex',
  options: [
    { value: 'claude-code', label: 'Claude Code', disabled: false },
    { value: 'codex', label: 'Codex', disabled: false },
    { value: 'gemini', label: 'Gemini CLI', disabled: true },
  ],
  help: 'Le Moteur du Rôle.',
  state: null,
} as const;
const toggle = { name: 'notifications', label: 'Notifications', checked: false, help: 'Sur le téléphone.', state: null } as const;
const textField = {
  name: 'title',
  label: 'Titre',
  value: 'Page Planning',
  placeholder: null,
  help: null,
  error: null,
  state: null,
  multiline: false,
  maxLength: null,
} as const;

const newForm = () => {
  const form = document.createElement('form');
  document.body.append(form);
  return form;
};

afterEach(() => document.body.replaceChildren());

describe('a form of Composants', () => {
  it('submits the values of its TextField, Select and Toggle in its FormData', async () => {
    const form = newForm();
    await render(COMPOSANTS.TextField, textField, {}, form);
    await render(COMPOSANTS.Select, select, {}, form);
    const el = await render(COMPOSANTS.Toggle, { ...toggle, checked: true }, {}, form);
    expect([...new FormData(form).entries()]).toEqual([
      ['title', 'Page Planning'],
      ['engine', 'codex'],
      ['notifications', 'on'],
    ]);
    inside(el, '[role=switch]').click();
    expect(new FormData(form).has('notifications')).toBe(false);
  });
});

describe('Select', () => {
  it('is a native select named by its label, its options with their disabled ones, described by its help', async () => {
    const el = await render(COMPOSANTS.Select, select);
    const native = inside<HTMLSelectElement>(el, 'select');
    expect(textOf(native.labels[0])).toBe('Moteur');
    expect(native.value).toBe('codex');
    expect([...native.options].map((option) => [option.value, option.text, option.disabled])).toEqual([
      ['claude-code', 'Claude Code', false],
      ['codex', 'Codex', false],
      ['gemini', 'Gemini CLI', true],
    ]);
    expect(textOf(inside(el, `#${native.getAttribute('aria-describedby')}`))).toBe('Le Moteur du Rôle.');
  });

  it('submits the option chosen, and sends input and change from its host', async () => {
    const form = newForm();
    const el = await render(COMPOSANTS.Select, select, {}, form);
    const seen: string[] = [];
    for (const type of ['input', 'change']) form.addEventListener(type, (event) => seen.push(`${type}:${(event.target as Element).localName}`));
    const native = inside<HTMLSelectElement>(el, 'select');
    native.value = 'claude-code';
    native.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    native.dispatchEvent(new Event('change', { bubbles: true }));
    expect(seen).toEqual(['input:cd-select', 'change:cd-select']);
    expect(new FormData(form).get('engine')).toBe('claude-code');
    expect((el as unknown as { value: string }).value).toBe('claude-code');
  });

  it('shows the value its data gives back after the Pilote chose others (a step back in the history)', async () => {
    const form = newForm();
    const el = await render(COMPOSANTS.Select, select, {}, form);
    const native = inside<HTMLSelectElement>(el, 'select');
    // The page follows each choice into data.value, as the library's Select does with ?c=.
    form.addEventListener('change', () => {
      el.data = { ...select, value: native.value };
    });
    await userEvent.selectOptions(native, 'claude-code');
    await settle(el);
    await userEvent.selectOptions(native, 'codex');
    await settle(el);
    el.data = { ...select, value: 'claude-code' };
    await settle(el);
    expect([native.value, (el as unknown as { value: string }).value, new FormData(form).get('engine')]).toEqual([
      'claude-code',
      'claude-code',
      'claude-code',
    ]);
  });

  it('disabled, submits nothing', async () => {
    const form = newForm();
    const el = await render(COMPOSANTS.Select, { ...select, state: 'disabled' }, {}, form);
    expect(inside<HTMLSelectElement>(el, 'select').disabled).toBe(true);
    expect(new FormData(form).has('engine')).toBe(false);
  });
});

describe('Toggle', () => {
  it('is a switch with aria-checked, named by its label and described by its help', async () => {
    const el = await render(COMPOSANTS.Toggle, toggle);
    const control = inside(el, '[role=switch]');
    expect(control.getAttribute('aria-checked')).toBe('false');
    expect(control.getAttribute('aria-labelledby')).not.toBeNull();
    expect(textOf(inside(el, `#${control.getAttribute('aria-labelledby')}`))).toBe('Notifications');
    expect(textOf(inside(el, `#${control.getAttribute('aria-describedby')}`))).toBe('Sur le téléphone.');
  });

  it('toggles on Space, telling its form and sending input and change', async () => {
    const form = newForm();
    const el = await render(COMPOSANTS.Toggle, toggle, {}, form);
    const control = inside(el, '[role=switch]');
    const seen: string[] = [];
    for (const type of ['input', 'change']) form.addEventListener(type, () => seen.push(type));
    control.focus();
    await userEvent.keyboard('{Space}');
    await settle(el);
    expect(control.getAttribute('aria-checked')).toBe('true');
    expect((el as unknown as { checked: boolean }).checked).toBe(true);
    expect(new FormData(form).get('notifications')).toBe('on');
    expect(seen).toEqual(['input', 'change']);
    await userEvent.keyboard('{Space}');
    await settle(el);
    expect(control.getAttribute('aria-checked')).toBe('false');
  });

  it('disabled, is neither focusable nor toggled', async () => {
    const el = await render(COMPOSANTS.Toggle, { ...toggle, state: 'disabled' });
    const control = inside<HTMLButtonElement>(el, '[role=switch]');
    control.focus();
    expect(el.shadowRoot?.activeElement).toBeNull();
    control.click();
    await settle(el);
    expect(control.getAttribute('aria-checked')).toBe('false');
  });
});

describe('Checkbox', () => {
  it('is a native checkbox with its label, submitted when checked', async () => {
    const form = newForm();
    const el = await render(COMPOSANTS.Checkbox, { name: 'personal-os', label: 'Personal OS', checked: false }, {}, form);
    const box = inside<HTMLInputElement>(el, 'input[type=checkbox]');
    expect(textOf(box.labels?.[0])).toBe('Personal OS');
    expect(new FormData(form).has('personal-os')).toBe(false);
    const changes = vi.fn();
    form.addEventListener('change', changes);
    box.click();
    expect(new FormData(form).get('personal-os')).toBe('on');
    expect(changes).toHaveBeenCalledOnce();
  });

  it('is up to date when its form hears input, before change', async () => {
    const form = newForm();
    const el = await render(COMPOSANTS.Checkbox, { name: 'personal-os', label: 'Personal OS', checked: false }, {}, form);
    const seen: unknown[] = [];
    for (const type of ['input', 'change'])
      form.addEventListener(type, () => seen.push([type, (el as unknown as { checked: boolean }).checked, new FormData(form).get('personal-os')]));
    inside<HTMLInputElement>(el, 'input[type=checkbox]').click();
    expect(seen).toEqual([
      ['input', true, 'on'],
      ['change', true, 'on'],
    ]);
  });
});

describe('Radio', () => {
  const cadence = [
    { name: 'cadence', value: 'nightly', label: 'Chaque nuit', checked: true },
    { name: 'cadence', value: 'at', label: 'À une heure', checked: false },
    { name: 'cadence', value: 'weekly', label: 'Chaque semaine', checked: false },
  ];
  const group = async () => {
    const form = newForm();
    const radios = [];
    for (const data of cadence) radios.push(await render(COMPOSANTS.Radio, data, {}, form));
    return { form, radios, inputs: radios.map((radio) => inside<HTMLInputElement>(radio, 'input[type=radio]')) };
  };

  it('is a native radio with its label; its group submits the checked one’s value', async () => {
    const { form, inputs } = await group();
    expect(textOf(inputs[1]?.labels?.[0])).toBe('À une heure');
    expect(new FormData(form).getAll('cadence')).toEqual(['nightly']);
    inputs[1]?.click();
    expect(new FormData(form).getAll('cadence')).toEqual(['at']);
    expect(inputs.map((input) => input.checked)).toEqual([false, true, false]);
  });

  it.each([
    ['a click', async (inputs: HTMLInputElement[]) => inputs[1]?.click()],
    [
      'an arrow key',
      async (inputs: HTMLInputElement[]) => {
        inputs[0]?.focus();
        await userEvent.keyboard('{ArrowDown}');
      },
    ],
  ])('is up to date when its form hears input, before change, after %s', async (_how, act) => {
    const { form, radios, inputs } = await group();
    const seen: unknown[] = [];
    const checked = () => radios.map((radio) => (radio as unknown as { checked: boolean }).checked);
    for (const type of ['input', 'change']) form.addEventListener(type, () => seen.push([type, checked(), new FormData(form).getAll('cadence')]));
    await act(inputs);
    expect(seen).toEqual([
      ['input', [false, true, false], ['at']],
      ['change', [false, true, false], ['at']],
    ]);
  });

  it('keeps one radio of its group in the tab order, and the arrow keys check the next one', async () => {
    const { form, inputs } = await group();
    expect(inputs.map((input) => input.tabIndex)).toEqual([0, -1, -1]);
    inputs[0]?.focus();
    await userEvent.keyboard('{ArrowDown}');
    expect(inputs.map((input) => input.checked)).toEqual([false, true, false]);
    expect(deepActiveElement()).toBe(inputs[1]);
    expect(inputs.map((input) => input.tabIndex)).toEqual([-1, 0, -1]);
    await userEvent.keyboard('{ArrowUp}');
    await userEvent.keyboard('{ArrowLeft}');
    expect(deepActiveElement()).toBe(inputs[2]);
    expect(new FormData(form).getAll('cadence')).toEqual(['weekly']);
  });
});

describe('SettingRow', () => {
  it.each([
    ['compte', 'settingRow.inherited'],
    ['projet', 'settingRow.changed'],
  ] as const)('with origin %s, says « %s »', async (origin, key) => {
    const el = await render(COMPOSANTS.SettingRow, { label: 'Revue visuelle', help: 'Étape optionnelle', origin }, { default: '<span>contrôle</span>' });
    expect(textOf(inside(el, '.origin'))).toBe(t(key));
  });

  it('with no origin, says neither; shows its label, its help and its control', async () => {
    const el = await render(COMPOSANTS.SettingRow, { label: 'Nom du Projet', help: 'Son nom dans la console.', origin: null }, { default: '<span>contrôle</span>' });
    expect(el.shadowRoot?.querySelector('.origin')).toBeNull();
    expect(textOf(el.shadowRoot)).not.toContain(t('settingRow.inherited'));
    expect(textOf(inside(el, '.label'))).toBe('Nom du Projet');
    expect(textOf(inside(el, '.help'))).toBe('Son nom dans la console.');
    expect(inside<HTMLSlotElement>(el, 'slot').assignedElements().map((node) => textOf(node))).toEqual(['contrôle']);
  });

  it('puts its control under its text on the phone, beside it at 1280 px', async () => {
    const el = await render(COMPOSANTS.SettingRow, { label: 'Rôle Review', help: 'Le Moteur de la revue.', origin: 'compte' }, { default: '<span>contrôle</span>' });
    const text = () => inside(el, '.text').getBoundingClientRect();
    const control = () => inside(el, '.control').getBoundingClientRect();
    await page.viewport(390, 844);
    expect(control().top).toBeGreaterThanOrEqual(text().bottom);
    await page.viewport(1280, 800);
    expect([control().top, control().left >= text().right]).toEqual([text().top, true]);
  });
});
