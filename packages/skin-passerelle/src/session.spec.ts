/// <reference types="vite/client" />
// What the core loads before the Skin (apps/web/src/main.ts): the tokens and the document's ground.
import './tokens.css';
import './document.css';
import { COMPOSANTS, t } from '@crewdeck/sdk';
import { page, userEvent } from 'vitest/browser';
import { actionsOf, defineSkin, inside, render, settle, textOf } from './testing/dom.js';

beforeAll(defineSkin);
afterEach(() => document.body.replaceChildren());

const SESSION = {
  id: '019a6f1e-7c3d-7e4f-9a1b-2c3d4e5f6a7b',
  title: 'Concevoir · Agenda partagé',
  meta: 'Personal OS · Conception · Claude Code',
  state: 'active',
  resumeDisabledReason: null,
  resumeLabel: null,
  resumeIcon: null,
} as const;

const message = (text: string) =>
  `<cd-message data='${JSON.stringify({ from: 'agent', text, at: '2026-11-11T14:00:00.000Z' })}'></cd-message>`;

const isShown = (el: Element) => el.getBoundingClientRect().width > 0;

describe('Session', () => {
  it.each(['active', 'waiting'] as const)('shows « Arrêter » while %s, which emits stop', async (state) => {
    const el = await render(COMPOSANTS.Session, { ...SESSION, state });
    expect(el.shadowRoot?.querySelector('cd-button.resume')).toBeNull();
    const stop = inside(el, 'cd-button.stop', 'button');
    expect(textOf(stop)).toBe(t('session.stop'));
    expect((inside(el, 'cd-button.stop') as HTMLElement & { data: unknown }).data).toMatchObject({ variant: 'secondary', icon: 'stop' });
    const details = await actionsOf(() => stop.click());
    expect(details).toEqual([{ composant: 'Session', action: 'stop', payload: {} }]);
  });

  it.each(['stopped', 'interrupted', 'failed'] as const)('shows « Reprendre » while %s, which emits resume', async (state) => {
    const el = await render(COMPOSANTS.Session, { ...SESSION, state });
    expect(el.shadowRoot?.querySelector('cd-button.stop')).toBeNull();
    const resume = inside<HTMLButtonElement>(el, 'cd-button.resume', 'button');
    expect(textOf(resume)).toBe(t('session.resume'));
    expect(resume.disabled).toBe(false);
    const details = await actionsOf(() => resume.click());
    expect(details).toEqual([{ composant: 'Session', action: 'resume', payload: {} }]);
  });

  it('a failed Commande shows « Relancer » with the refresh icon, which emits resume', async () => {
    const el = await render(COMPOSANTS.Session, { ...SESSION, state: 'failed', resumeLabel: 'Relancer', resumeIcon: 'refresh' });
    const host = inside<HTMLElement & { data: unknown }>(el, 'cd-button.resume');
    expect(host.data).toMatchObject({ label: 'Relancer', icon: 'refresh', variant: 'secondary' });
    const resume = inside<HTMLButtonElement>(host, 'button');
    expect(textOf(resume)).toBe('Relancer');
    const details = await actionsOf(() => resume.click());
    expect(details).toEqual([{ composant: 'Session', action: 'resume', payload: {} }]);
  });

  it('says « échouée » once failed, with a halt dot', async () => {
    const el = await render(COMPOSANTS.Session, { ...SESSION, state: 'failed' });
    expect(textOf(inside(el, '.meta'))).toBe(`${t('session.state.failed')} · ${SESSION.meta}`);
    expect(t('session.state.failed')).toBe('échouée');
    expect((inside(el, 'cd-status-dot') as HTMLElement & { data: unknown }).data).toMatchObject({ tone: 'halt', pulse: false });
  });

  it('takes « Reprendre » and play without a resume label nor icon', async () => {
    const el = await render(COMPOSANTS.Session, { ...SESSION, state: 'stopped' });
    expect((inside(el, 'cd-button.resume') as HTMLElement & { data: unknown }).data).toMatchObject({ label: t('session.resume'), icon: 'play' });
  });

  it('disables « Reprendre » with its reason beside it, and emits nothing', async () => {
    const el = await render(COMPOSANTS.Session, { ...SESSION, state: 'interrupted', resumeDisabledReason: 'Runner hors ligne' });
    const host = inside(el, 'cd-button.resume');
    const resume = inside<HTMLButtonElement>(host, 'button');
    expect(resume.disabled).toBe(true);
    expect(textOf(inside(host, '.reason'))).toBe('Runner hors ligne');
    const details = await actionsOf(() => {
      resume.click();
      host.click();
    });
    expect(details).toEqual([]);
  });

  it('says its state beside its meta', async () => {
    const el = await render(COMPOSANTS.Session, { ...SESSION, state: 'waiting' });
    expect(textOf(inside(el, '.meta'))).toBe(`${t('session.state.waiting')} · ${SESSION.meta}`);
    expect(textOf(inside(el, 'h2'))).toBe(SESSION.title);
  });

  it('puts its messages in a polite log, then its Composer', async () => {
    const composer = `<cd-composer data='{"placeholder":"Écrire","hint":null,"state":"idle","value":"","dictation":false}'></cd-composer>`;
    const el = await render(COMPOSANTS.Session, SESSION, { default: message('Bonjour'), composer });
    const log = inside(el, '[role=log]');
    expect(log.getAttribute('aria-live')).toBe('polite');
    expect(log.getAttribute('aria-label')).toBe(t('session.log'));
    const slot = log.querySelector<HTMLSlotElement>('slot:not([name])');
    expect(slot?.assignedElements().map((node) => node.localName)).toEqual(['cd-message']);
    expect(log.querySelector('slot[name=composer]')).toBeNull();
    expect(el.shadowRoot?.querySelector<HTMLSlotElement>('slot[name=composer]')?.assignedElements()).toHaveLength(1);
  });

  describe('its close buttons', () => {
    afterEach(() => page.viewport(414, 896));

    it('are the back arrow « Retour » on a phone', async () => {
      await page.viewport(390, 844);
      const el = await render(COMPOSANTS.Session, SESSION);
      const back = inside(el, 'cd-icon-button.back');
      expect(isShown(back)).toBe(true);
      expect(inside(back, 'button').getAttribute('aria-label')).toBe(t('session.back'));
      expect(isShown(inside(el, 'cd-icon-button.close'))).toBe(false);
      expect(isShown(inside(el, 'cd-icon-button.expand'))).toBe(false);
      const details = await actionsOf(() => inside(back, 'button').click());
      expect(details).toEqual([{ composant: 'Session', action: 'close', payload: {} }]);
    });

    it('are « Agrandir » and « Fermer » at 1280 px', async () => {
      await page.viewport(1280, 800);
      const el = await render(COMPOSANTS.Session, SESSION);
      expect(isShown(inside(el, 'cd-icon-button.back'))).toBe(false);
      const expand = inside(el, 'cd-icon-button.expand');
      const close = inside(el, 'cd-icon-button.close');
      expect([isShown(expand), isShown(close)]).toEqual([true, true]);
      expect(inside(expand, 'button').getAttribute('aria-label')).toBe(t('session.expand'));
      expect(inside(close, 'button').getAttribute('aria-label')).toBe(t('session.close'));
      const details = await actionsOf(() => {
        inside(expand, 'button').click();
        inside(close, 'button').click();
      });
      expect(details.map((detail) => detail.action)).toEqual(['expand', 'close']);
    });
  });

  describe('its log', () => {
    const tall = async () => {
      const el = await render(
        COMPOSANTS.Session,
        SESSION,
        { default: Array.from({ length: 20 }, (_, i) => message(`Message ${i + 1}`)).join('') },
      );
      el.style.height = '320px';
      await settle(el);
      return { el, log: inside(el, '[role=log]') };
    };
    const atBottom = (log: Element) => Math.abs(log.scrollHeight - log.clientHeight - log.scrollTop) <= 1;
    const append = async (el: Element, text: string) => {
      const template = document.createElement('template');
      template.innerHTML = message(text);
      el.append(template.content);
      await settle(el);
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    };

    it('scrolls, and keeps to the bottom as messages come', async () => {
      const { el, log } = await tall();
      expect(log.scrollHeight).toBeGreaterThan(log.clientHeight);
      await vi.waitFor(() => expect(atBottom(log)).toBe(true));
      await append(el, 'Un de plus');
      await vi.waitFor(() => expect(atBottom(log)).toBe(true));
    });

    it('stays where the Pilote scrolled up to', async () => {
      const { el, log } = await tall();
      await vi.waitFor(() => expect(atBottom(log)).toBe(true));
      log.scrollTop = 0;
      log.dispatchEvent(new Event('scroll'));
      await append(el, 'Un de plus');
      expect(log.scrollTop).toBe(0);
    });

    it('follows again only once the Pilote is back at the bottom, not past where it was', async () => {
      const { el, log } = await tall();
      await vi.waitFor(() => expect(atBottom(log)).toBe(true));
      const oldBottom = log.scrollTop;
      const scrollTo = async (top: number) => {
        log.scrollTop = top;
        log.dispatchEvent(new Event('scroll'));
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      };
      await scrollTo(0);
      for (const n of [1, 2, 3, 4, 5, 6, 7, 8]) await append(el, `Arrivé pendant la lecture ${n}`);
      const reading = oldBottom + 100;
      expect(log.scrollHeight - log.clientHeight).toBeGreaterThan(reading + 100);
      await scrollTo(reading);
      await append(el, 'Encore un');
      expect(log.scrollTop).toBe(reading);

      await scrollTo(log.scrollHeight);
      await append(el, 'Le dernier');
      await vi.waitFor(() => expect(atBottom(log)).toBe(true));
    });
  });
});

describe('Message', () => {
  const agent = (text: string) => render(COMPOSANTS.Message, { from: 'agent', text, at: '2026-11-11T14:00:00.000Z' });

  it('renders the agent’s Markdown: bold, and links opened apart', async () => {
    const el = await agent('Du **gras**, [le PRD](https://example.com/prd) et https://example.com/nu');
    expect(textOf(inside(el, '.text strong'))).toBe('gras');
    const links = [...(el.shadowRoot?.querySelectorAll('.text a') ?? [])];
    expect(links.map((link) => [link.getAttribute('href'), link.getAttribute('rel'), link.getAttribute('target')])).toEqual([
      ['https://example.com/prd', 'noopener noreferrer', '_blank'],
      ['https://example.com/nu', 'noopener noreferrer', '_blank'],
    ]);
  });

  it('shows the agent’s HTML as text, never as elements', async () => {
    const el = await agent('<script>alert(1)</script> <img src=x onerror="alert(2)">');
    const text = inside(el, '.text');
    expect(text.querySelector('script, img')).toBeNull();
    expect(textOf(text)).toContain('<script>alert(1)</script>');
  });

  it('never links to a javascript: URL', async () => {
    const el = await agent('[clique](javascript:alert(1))');
    expect(el.shadowRoot?.querySelector('a')).toBeNull();
  });

  it('shows the Pilote’s text as typed, Markdown and line breaks included', async () => {
    const el = await render(COMPOSANTS.Message, { from: 'pilote', text: 'Du **gras**\net une ligne', at: '2026-11-11T14:00:00.000Z' });
    const text = inside(el, '.text');
    expect(text.querySelector('strong')).toBeNull();
    expect(text.textContent).toBe('Du **gras**\net une ligne');
    expect(getComputedStyle(text).whiteSpace).toBe('pre-wrap');
  });

  it('names its author for screen readers and gives its time', async () => {
    const el = await agent('Bonjour');
    expect(textOf(inside(el, '.visually-hidden'))).toBe(t('message.from.agent'));
    expect(inside(el, 'time').getAttribute('datetime')).toBe('2026-11-11T14:00:00.000Z');
  });
});

describe('ToolCall', () => {
  it('shows its tool, target and detail in mono', async () => {
    const el = await render(COMPOSANTS.ToolCall, { tool: 'Read', target: 'docs/product/prd.md', detail: '281 lignes' });
    expect(textOf(inside(el, '.tool'))).toBe('Read');
    expect(textOf(inside(el, 'code.target'))).toBe('docs/product/prd.md');
    expect(textOf(inside(el, '.detail'))).toBe('281 lignes');
    expect(getComputedStyle(inside(el, '.call')).fontFamily).toMatch(/Mono/);
  });

  it('leaves out a missing target and detail', async () => {
    const el = await render(COMPOSANTS.ToolCall, { tool: 'TodoWrite', target: null, detail: null });
    expect(el.shadowRoot?.querySelector('.target, .detail')).toBeNull();
  });
});

describe('Question', () => {
  const [single, multiple] = COMPOSANTS.Question.examples;
  const answer = (el: Element) => actionsOf(() => inside(el, 'cd-button.answer', 'button').click());

  it('offers radios, the selected one checked, and answers with it', async () => {
    const el = await render(COMPOSANTS.Question, single?.data);
    const inputs = [...(el.shadowRoot?.querySelectorAll<HTMLInputElement>('input') ?? [])];
    expect(inputs.map((input) => [input.type, input.checked])).toEqual([
      ['radio', true],
      ['radio', false],
      ['radio', false],
    ]);
    expect(textOf(inside(el, '.kicker'))).toBe('Question 1 sur 3');
    expect(textOf(inside(el, 'cd-button.answer', 'button'))).toBe(t('question.answer'));
    expect(await answer(el)).toEqual([
      { composant: 'Question', action: 'answer', payload: { questionId: 'q-agenda-1', optionIds: ['tous'] } },
    ]);
  });

  it('answers with the option the Pilote picked', async () => {
    const el = await render(COMPOSANTS.Question, single?.data);
    inside(el, 'label:nth-of-type(2)').click();
    expect((await answer(el)).map((detail) => detail.payload)).toEqual([{ questionId: 'q-agenda-1', optionIds: ['auteur'] }]);
  });

  it('moves between the options with the arrow keys', async () => {
    const el = await render(COMPOSANTS.Question, single?.data);
    inside<HTMLInputElement>(el, 'input:checked').focus();
    await userEvent.keyboard('{ArrowDown}');
    expect((el.shadowRoot?.activeElement as HTMLInputElement | null)?.value).toBe('auteur');
    expect((await answer(el)).map((detail) => detail.payload)).toEqual([{ questionId: 'q-agenda-1', optionIds: ['auteur'] }]);
  });

  it('is a group named by its title', async () => {
    const el = await render(COMPOSANTS.Question, single?.data);
    const group = inside(el, '[role=radiogroup]');
    expect(textOf(inside(el, `#${group.getAttribute('aria-labelledby')}`))).toBe(single?.data.title);
  });

  it('offers checkboxes when several options may be chosen, and answers with all of them', async () => {
    const el = await render(COMPOSANTS.Question, multiple?.data);
    expect(el.shadowRoot?.querySelector('[role=group]')).not.toBeNull();
    const inputs = [...(el.shadowRoot?.querySelectorAll<HTMLInputElement>('input') ?? [])];
    expect(inputs.map((input) => input.type)).toEqual(['checkbox', 'checkbox', 'checkbox']);
    inputs[2]?.click();
    expect((await answer(el)).map((detail) => detail.payload)).toEqual([
      { questionId: 'q-agenda-2', optionIds: ['notification', 'sms'] },
    ]);
    expect(textOf(inside(el, '.kicker'))).toBe(t('question.kicker'));
  });

  it('answers nothing while no option is chosen', async () => {
    const el = await render(COMPOSANTS.Question, {
      ...multiple?.data,
      options: multiple?.data.options.map((option) => ({ ...option, selected: false })),
    });
    expect(inside<HTMLButtonElement>(el, 'cd-button.answer', 'button').disabled).toBe(true);
    expect(await answer(el)).toEqual([]);
  });
});

describe('PermissionRequest', () => {
  const request = { id: 'p-push-1', tool: 'Bash', command: 'git push origin design/agenda-partage' };

  it('names the tool and shows the command in a mono block', async () => {
    const el = await render(COMPOSANTS.PermissionRequest, request);
    expect(textOf(inside(el, 'h3'))).toBe(t('permissionRequest.title', { tool: 'Bash' }));
    expect(textOf(inside(el, 'pre code'))).toBe(request.command);
  });

  it.each([
    ['allow', 'permissionRequest.allow', 'primary'],
    ['allow-for-session', 'permissionRequest.allowForSession', 'secondary'],
    ['deny', 'permissionRequest.deny', 'ghost'],
  ] as const)('« %s » emits its action with the request’s id', async (name, label, variant) => {
    const el = await render(COMPOSANTS.PermissionRequest, request);
    const host = inside(el, `cd-button.${name}`) as HTMLElement & { data: unknown };
    expect(host.data).toMatchObject({ label: t(label), variant });
    const details = await actionsOf(() => inside(host, 'button').click());
    const action = name === 'allow-for-session' ? 'allowForSession' : name;
    expect(details).toEqual([{ composant: 'PermissionRequest', action, payload: { id: 'p-push-1' } }]);
  });
});
