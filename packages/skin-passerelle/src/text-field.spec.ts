import { COMPOSANTS } from '@crewdeck/sdk';
import { inside, render, settle, textOf } from './testing/browser.js';

const field = {
  name: 'time',
  label: 'Heure',
  value: '07:30',
  placeholder: null,
  help: 'L’heure de la Planification.',
  error: null,
  state: null,
  multiline: false,
  maxLength: null,
} as const;

/** A `<form>` in the document holding `field`'s TextField. */
const inForm = async (data: object) => {
  const form = document.createElement('form');
  document.body.append(form);
  const el = await render(COMPOSANTS.TextField, data, {}, form);
  return { form, el };
};

afterEach(() => document.body.replaceChildren());

describe('TextField', () => {
  it('is a native input named by its label, with its value, its placeholder and its help', async () => {
    const el = await render(COMPOSANTS.TextField, { ...field, placeholder: 'hh:mm' });
    const input = inside<HTMLInputElement>(el, 'input');
    expect(input.labels?.[0] && textOf(input.labels[0])).toBe('Heure');
    expect(input.value).toBe('07:30');
    expect(input.placeholder).toBe('hh:mm');
    const help = inside(el, `#${input.getAttribute('aria-describedby')}`);
    expect(textOf(help)).toBe('L’heure de la Planification.');
  });

  it('submits its value under its name in its form’s FormData, what is typed included', async () => {
    const { form, el } = await inForm(field);
    expect(new FormData(form).get('time')).toBe('07:30');
    const input = inside<HTMLInputElement>(el, 'input');
    input.value = '08:15';
    input.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true }));
    expect(new FormData(form).get('time')).toBe('08:15');
  });

  it('with an error, reports itself invalid to its form and shows the message under it, linked by aria-describedby', async () => {
    const { form, el } = await inForm({ ...field, value: '25:00', error: 'Une heure entre 00:00 et 23:59.' });
    expect(form.checkValidity()).toBe(false);
    expect((el as unknown as { validity: ValidityState }).validity.valid).toBe(false);
    expect((el as unknown as { validationMessage: string }).validationMessage).toBe('Une heure entre 00:00 et 23:59.');
    const input = inside<HTMLInputElement>(el, 'input');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    const described = (input.getAttribute('aria-describedby') ?? '').split(' ').map((id) => textOf(inside(el, `#${id}`)));
    expect(described).toContain('Une heure entre 00:00 et 23:59.');
    const message = inside(el, '.error');
    expect(textOf(message)).toBe('Une heure entre 00:00 et 23:59.');
    expect(message.getBoundingClientRect().top).toBeGreaterThanOrEqual(input.getBoundingClientRect().bottom);
  });

  it('becomes valid again once its error is gone', async () => {
    const { form, el } = await inForm({ ...field, error: 'Une heure entre 00:00 et 23:59.' });
    el.data = { ...field };
    await settle(el);
    expect(form.checkValidity()).toBe(true);
    expect(el.shadowRoot?.querySelector('.error')).toBeNull();
    expect(inside(el, 'input').hasAttribute('aria-invalid')).toBe(false);
  });

  it('multiline is a textarea, its length capped by maxLength', async () => {
    const { form, el } = await inForm({ ...field, name: 'comment', value: 'Reprendre le test.', multiline: true, maxLength: 2000 });
    const area = inside<HTMLTextAreaElement>(el, 'textarea');
    expect(area.maxLength).toBe(2000);
    expect(new FormData(form).get('comment')).toBe('Reprendre le test.');
  });

  it('disabled, is neither focusable nor submitted', async () => {
    const { form, el } = await inForm({ ...field, state: 'disabled' });
    const input = inside<HTMLInputElement>(el, 'input');
    expect(input.disabled).toBe(true);
    input.focus();
    expect(el.shadowRoot?.activeElement).toBeNull();
    expect(new FormData(form).has('time')).toBe(false);
  });

  it('lets the native input event out of its shadow root, and sends a composed change', async () => {
    const el = await render(COMPOSANTS.TextField, field);
    const seen: string[] = [];
    for (const type of ['input', 'change']) document.body.addEventListener(type, (event) => seen.push(`${type}:${(event.target as Element).localName}`));
    const input = inside<HTMLInputElement>(el, 'input');
    input.value = '09:00';
    input.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    expect(seen).toEqual(['input:cd-text-field', 'change:cd-text-field']);
    expect((el as unknown as { value: string }).value).toBe('09:00');
  });
});
