/// <reference types="vite/client" />
import './tokens.css';
import './document.css';
import { COMPOSANTS, t } from '@crewdeck/sdk';
import { page, userEvent } from 'vitest/browser';
import { actionsOf, defineSkin, inside, render, settle, textOf } from './testing/dom.js';

beforeAll(defineSkin);

afterEach(async () => {
  document.body.replaceChildren();
  await page.viewport(1280, 800);
});

const [nine, chosen, empty] = COMPOSANTS.PageAToi.examples;
if (!nine || !chosen || !empty) throw new Error('PageAToi lacks its examples');

const rows = (el: Element) => [...(el.shadowRoot?.querySelectorAll('cd-decision-row') ?? [])];
const chips = (el: Element) => [...(inside(el, 'cd-project-filter').shadowRoot?.querySelectorAll('cd-chip') ?? [])];

describe('PageAToi', () => {
  it('titles the page « À toi » with every open Décision counted, « 0 Décision » when none', async () => {
    const el = await render(COMPOSANTS.PageAToi, nine.data);
    expect(textOf(inside(el, 'cd-page-header', 'h1'))).toBe('À toi');
    expect(textOf(inside(el, 'cd-page-header', '.count'))).toBe('9 Décisions');
    el.data = { ...empty.data };
    await settle(el);
    expect(textOf(inside(el, 'cd-page-header', '.count'))).toBe('0 Décision');
  });

  it('shows a chip per Projet with its count, the selected one pressed', async () => {
    const el = await render(COMPOSANTS.PageAToi, chosen.data);
    expect(chips(el).map((chip) => textOf(inside(chip, 'button')))).toEqual([
      'Tous les Projets9',
      'Crewdeck2',
      'Personal OS4',
      'Site mairie2',
      'Tennis Manager1',
    ]);
    expect(chips(el).map((chip) => inside(chip, 'button').getAttribute('aria-pressed'))).toEqual(['false', 'true', 'false', 'false', 'false']);
  });

  it('lists the Décisions it is given, in order, in the card « Décisions » counting them', async () => {
    const el = await render(COMPOSANTS.PageAToi, chosen.data);
    const card = inside(el, 'cd-card.decisions');
    expect(textOf(inside(card, 'h2'))).toBe('Décisions2');
    expect(inside(card, 'section').getAttribute('aria-label')).toBe('À toi / Décisions');
    expect(rows(el).map((row) => textOf(inside(row, '.open')))).toEqual([
      'Ticket bloqué · #42 Connexion GitHub',
      'Permission demandée · Code · #44 Liste des Projets',
    ]);
  });

  it('gives each Décision its buttons, one that cannot be pressed disabled with its reason', async () => {
    const el = await render(COMPOSANTS.PageAToi, {
      ...chosen.data,
      decisions: [
        {
          ...chosen.data.decisions[0],
          actions: [
            { id: 'open', label: 'Ouvrir', primary: false, disabledReason: null },
            { id: 'retry', label: 'Relancer', primary: true, disabledReason: 'Le Runner est hors ligne' },
          ],
        },
      ],
    });
    const buttons = [...(rows(el)[0]?.querySelectorAll('cd-button') ?? [])];
    expect(buttons.map((button) => button.getAttribute('slot'))).toEqual(['actions', 'actions']);
    expect(buttons.map((button) => textOf(inside(button, 'button')))).toEqual(['Ouvrir', 'Relancer']);
    expect(buttons.map((button) => inside<HTMLButtonElement>(button, 'button').disabled)).toEqual([false, true]);
    expect(textOf(inside(buttons[1] as Element, '.reason'))).toBe('Le Runner est hors ligne');
  });

  it('says « Rien ne t’attend » when no Décision waits', async () => {
    const el = await render(COMPOSANTS.PageAToi, empty.data);
    expect(rows(el)).toEqual([]);
    expect(textOf(inside(el, 'cd-card.decisions', 'h2'))).toBe('Décisions0');
    expect(textOf(inside(el, 'cd-empty', '.title'))).toBe(t('aToi.empty.title'));
    expect(textOf(inside(el, 'cd-empty'))).toBe(t('aToi.empty.body'));
  });

  it('shows « Noter une Idée » only when the Pilote can note one', async () => {
    const without = await render(COMPOSANTS.PageAToi, nine.data);
    expect(without.shadowRoot?.querySelector('cd-button.note-idea')).toBeNull();
    const able = await render(COMPOSANTS.PageAToi, chosen.data);
    expect(textOf(inside(able, 'cd-button.note-idea', 'button'))).toBe('Noter une Idée');
  });

  it('emits its own actions, never its rows’ nor its chips’', async () => {
    const el = await render(COMPOSANTS.PageAToi, chosen.data);
    const first = chosen.data.decisions[0];
    if (!first) throw new Error('no Décision');
    expect(await actionsOf(() => inside(chips(el)[2] as Element, 'button').click())).toEqual([
      { composant: 'PageAToi', action: 'filter', payload: { projectId: chosen.data.projects[2]?.id } },
    ]);
    expect(await actionsOf(() => inside(chips(el)[0] as Element, 'button').click())).toEqual([
      { composant: 'PageAToi', action: 'filter', payload: { projectId: null } },
    ]);
    expect(await actionsOf(() => inside(rows(el)[0] as Element, '.open').click())).toEqual([
      { composant: 'PageAToi', action: 'open', payload: { id: first.id } },
    ]);
    const button = rows(el)[0]?.querySelector('cd-button');
    expect(await actionsOf(() => inside(button as Element, 'button').click())).toEqual([
      { composant: 'PageAToi', action: 'act', payload: { id: first.id, action: 'open' } },
    ]);
    expect(await actionsOf(() => inside(el, 'cd-button.note-idea', 'button').click())).toEqual([
      { composant: 'PageAToi', action: 'note-idea', payload: {} },
    ]);
  });

  describe('a Décision with buttons of its own, narrower than 1280 px', () => {
    const first = chosen.data.decisions[0];
    if (!first) throw new Error('no Décision');
    const answered = {
      ...first,
      context: 'Review a demandé des changements 4 fois.',
      actions: [
        { id: 'one-more-pass', label: 'Encore un passage', primary: true, disabledReason: null },
        { id: 'stop', label: 'Arrêter', primary: false, disabledReason: null },
      ],
    };
    const withAnswers = { ...chosen.data, decisions: [answered, ...chosen.data.decisions.slice(1)] };
    const opened = (el: Element) => el.shadowRoot?.querySelector('cd-dialog.opened') ?? null;
    const openedButtons = (el: Element) => [...(opened(el)?.querySelectorAll('cd-button') ?? [])];

    it('opens in place on a tap: its kind, meta and context, and its buttons; one emits `act` and closes it', async () => {
      await page.viewport(390, 800);
      const el = await render(COMPOSANTS.PageAToi, withAnswers);
      expect(opened(el)).toBeNull();

      expect(await actionsOf(() => inside(rows(el)[0] as Element, '.open').click())).toEqual([]);
      await settle(el);
      const dialog = opened(el) as Element;
      expect(inside<HTMLDialogElement>(dialog, 'dialog').open).toBe(true);
      expect(textOf(inside(dialog, 'h2'))).toBe(answered.title);
      expect([...dialog.querySelectorAll('p')].map((line) => textOf(line))).toEqual([answered.kind, answered.meta, answered.context]);
      expect(openedButtons(el).map((button) => textOf(inside(button, 'button')))).toEqual(['Encore un passage', 'Arrêter']);
      expect(inside(openedButtons(el)[0] as Element, 'button').getBoundingClientRect().width).toBeGreaterThan(0);

      expect(await actionsOf(() => inside(openedButtons(el)[1] as Element, 'button').click())).toEqual([
        { composant: 'PageAToi', action: 'act', payload: { id: answered.id, action: 'stop' } },
      ]);
      await settle(el);
      expect(opened(el)).toBeNull();
    });

    it('closes on Escape without answering', async () => {
      await page.viewport(390, 800);
      const el = await render(COMPOSANTS.PageAToi, withAnswers);
      inside(rows(el)[0] as Element, '.open').click();
      await settle(el);
      expect(await actionsOf(() => userEvent.keyboard('{Escape}'))).toEqual([]);
      await settle(el);
      expect(opened(el)).toBeNull();
    });

    it('keeps `open` for a Décision whose only button is « Ouvrir », and from 1280 px for every one', async () => {
      await page.viewport(390, 800);
      const el = await render(COMPOSANTS.PageAToi, withAnswers);
      const second = chosen.data.decisions[1];
      expect(await actionsOf(() => inside(rows(el)[1] as Element, '.open').click())).toEqual([
        { composant: 'PageAToi', action: 'open', payload: { id: second?.id } },
      ]);
      await page.viewport(1280, 800);
      await settle(el);
      expect(await actionsOf(() => inside(rows(el)[0] as Element, '.open').click())).toEqual([
        { composant: 'PageAToi', action: 'open', payload: { id: answered.id } },
      ]);
      await settle(el);
      expect(opened(el)).toBeNull();
    });

    it('closes once the screen reaches 1280 px, where the row shows its buttons again', async () => {
      await page.viewport(390, 800);
      const el = await render(COMPOSANTS.PageAToi, withAnswers);
      inside(rows(el)[0] as Element, '.open').click();
      await settle(el);
      expect(opened(el)).not.toBeNull();
      await page.viewport(1280, 800);
      // `change` of the media query comes after the resize.
      await expect.poll(() => opened(el)).toBeNull();
    });
  });

  it('sets its Emplacements beside the list from 1280 px, below it on a phone, and drops an empty aside', async () => {
    const el = await render(COMPOSANTS.PageAToi, chosen.data, chosen.slots as Record<string, string>);
    const list = inside(el, 'cd-card.decisions').getBoundingClientRect();
    const aside = inside(el, '.aside');
    expect(aside.hidden).toBe(false);
    expect(aside.getBoundingClientRect().left).toBeGreaterThan(list.right);
    await page.viewport(390, 800);
    await settle(el);
    expect(aside.getBoundingClientRect().top).toBeGreaterThan(inside(el, 'cd-card.decisions').getBoundingClientRect().bottom - 1);

    const bare = await render(COMPOSANTS.PageAToi, nine.data);
    expect(inside(bare, '.aside').hidden).toBe(true);
  });
});
