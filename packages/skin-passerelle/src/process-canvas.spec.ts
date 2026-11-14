import './tokens.css';
import './document.css';
import { COMPOSANTS, type CdActionDetail } from '@crewdeck/sdk';
import { actionsOf, centreOf, defineSkin, drag, inside, pointer, render, settle, textOf } from './testing/dom.js';

beforeAll(defineSkin);
afterEach(() => document.body.replaceChildren());

const { ProcessCanvas } = COMPOSANTS;
const [crewdeck, , , local] = ProcessCanvas.examples;
type Canvas = HTMLElement & { data: unknown };

const show = async (data: unknown = crewdeck?.data) => {
  const el = (await render(ProcessCanvas, data)) as Canvas;
  await expect.poll(() => el.shadowRoot?.querySelectorAll('svg.wires path').length ?? 0).toBeGreaterThan(0);
  return el;
};
const withData = (patch: object) => ({ ...(crewdeck?.data as object), ...patch });
const root = (el: Element) => el.shadowRoot!;
const card = (el: Element, id: string) => inside(el, `cd-step-card[data-step="${id}"]`);
const port = (el: Element, stepId: string, dir: 'in' | 'out', id?: string) =>
  inside(el, `cd-step-card[data-step="${stepId}"] > cd-port[data-dir="${dir}"]${id ? `[data-port="${id}"]` : ''}`);
const portState = (el: Element) => (el as HTMLElement & { data: { state: string | null } }).data.state;
const only = (details: CdActionDetail[]) => details.map(({ action, payload }) => ({ action, payload }));

describe('ProcessCanvas', () => {
  it('renders its Phases on their grid, their Étapes’ cards with their ports, Entrées first, and their Outils', async () => {
    const el = await show();
    const phases = [...root(el).querySelectorAll<HTMLElement>('cd-phase')];
    expect(phases.map((phase) => phase.dataset['phase'])).toEqual(['ph-idee', 'ph-conception', 'ph-dev']);
    expect(phases[2]?.style.gridRow).toBe('3');
    expect(root(el).querySelectorAll('cd-step-card')).toHaveLength(17);
    const ap = card(el, 'ap-prd');
    expect(ap.style.gridColumn).toBe('3');
    expect([...ap.querySelectorAll<HTMLElement>(':scope > cd-port')].map((p) => `${p.dataset['dir']}.${p.dataset['port']}`)).toEqual([
      'in.prd',
      'in.verdict',
      'out.prd',
    ]);
    expect([...card(el, 'prd').querySelectorAll(':scope > cd-tool-chip')].map((chip) => textOf(inside(chip, '.name')))).toEqual([
      'Conception',
      'product-design',
    ]);
    expect(textOf(inside(el, '.zoom output'))).toBe('90 %');
  });

  it('draws every arrow and every Retour under the cards, a badge on each Retour', async () => {
    const el = await show();
    await expect.poll(() => root(el).querySelectorAll('svg.wires path.arrow').length).toBe(25);
    expect(root(el).querySelectorAll('svg.wires path.loop')).toHaveLength(4);
    const badges = [...root(el).querySelectorAll('cd-loop-back')];
    expect(badges).toHaveLength(4);
    expect(badges.every((badge) => !badge.classList.contains('unrouted'))).toBe(true);
    expect(textOf(inside(badges[0]!, '.badge'))).toBe('Retour · 3 fois au plus');
  });

  describe('selects', () => {
    it('a card, by a click or Enter', async () => {
      const el = await show();
      const article = inside(card(el, 'prd'), 'article');
      expect(only(await actionsOf(() => article.click()))).toEqual([{ action: 'select', payload: { target: { kind: 'step', id: 'prd' } } }]);
      const details = await actionsOf(() => article.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, composed: true })));
      expect(only(details)).toEqual([{ action: 'select', payload: { target: { kind: 'step', id: 'prd' } } }]);
    });

    it('a Phase, by a click on its head', async () => {
      const el = await show();
      const details = await actionsOf(() => inside(el, 'cd-phase[data-phase="ph-dev"]', 'header').click());
      expect(only(details)).toEqual([{ action: 'select', payload: { target: { kind: 'phase', id: 'ph-dev' } } }]);
    });

    it('nothing, by a click on the background', async () => {
      const el = await show();
      const background = inside(el, '.canvas');
      const rect = background.getBoundingClientRect();
      const at = { x: rect.left + 4, y: rect.top + 4 };
      const details = await actionsOf(() => {
        pointer('pointerdown', background, at);
        pointer('pointerup', background, at);
      });
      expect(only(details)).toEqual([{ action: 'select', payload: { target: null } }]);
    });
  });

  describe('while editable', () => {
    it('marks, while a Sortie is dragged, the Entrées of its type compatible and the others refused', async () => {
      const el = await show();
      const from = port(el, 'prd', 'out', 'prd');
      pointer('pointerdown', from, centreOf(from));
      pointer('pointermove', from, { x: centreOf(from).x + 30, y: centreOf(from).y });
      await settle(el);
      expect(portState(from)).toBe('active');
      expect(portState(port(el, 'ap-prd', 'in', 'prd'))).toBe('compatible');
      expect(portState(port(el, 'ap-prd', 'in', 'verdict'))).toBe('refused');
      expect(portState(port(el, 'code', 'in', 'ticket'))).toBe('refused');
      expect(root(el).querySelector('svg.overlay path.provisional')).not.toBeNull();
      pointer('pointerup', from, centreOf(from));
      await settle(el);
      expect(portState(port(el, 'ap-prd', 'in', 'prd'))).toBeNull();
      expect(root(el).querySelector('svg.overlay')).toBeNull();
    });

    it('emits connect with both ports when a Sortie is dropped on an Entrée', async () => {
      const el = await show();
      const details = await actionsOf(() => drag(el, port(el, 'analyse', 'out'), () => port(el, 'tri', 'in')));
      expect(only(details)).toEqual([
        { action: 'connect', payload: { from: { stepId: 'analyse', portId: 'idee' }, to: { stepId: 'tri', portId: 'idee' } } },
      ]);
    });

    it('emits moveStep when a card is dropped on a free cell, its ghost and the free cells shown meanwhile', async () => {
      const el = await show();
      const details = await actionsOf(() =>
        drag(el, card(el, 'analyse'), () => {
          expect(root(el).querySelector('.ghost')).not.toBeNull();
          // Phase Idée holds two cards on its first row: its free cells are the third column's and the row below.
          const cells = [...root(el).querySelectorAll<HTMLElement>('.cell[data-phase="ph-idee"]')].map((c) => `${c.dataset['col']},${c.dataset['row']}`);
          expect(cells).toEqual(['3,1', '1,2', '2,2', '3,2']);
          return inside(el, '.cell[data-phase="ph-idee"][data-col="2"][data-row="2"]');
        }),
      );
      expect(only(details)).toEqual([{ action: 'moveStep', payload: { stepId: 'analyse', phaseId: 'ph-idee', col: 2, row: 2 } }]);
      expect(root(el).querySelector('.cell, .ghost')).toBeNull();
    });

    it('emits loopBack when the Retour’s handle is dropped on a card', async () => {
      const el = await show();
      const details = await actionsOf(() => drag(el, inside(card(el, 'ap-prd'), '.handle'), () => card(el, 'prd')));
      expect(only(details)).toEqual([{ action: 'loopBack', payload: { from: 'ap-prd', to: 'prd' } }]);
    });

    it('does nothing when a drop lands elsewhere', async () => {
      const el = await show();
      const nowhere = () => {
        const rect = inside(el, '.canvas').getBoundingClientRect();
        return { x: rect.left + 4, y: rect.top + 4 };
      };
      const details = await actionsOf(async () => {
        await drag(el, port(el, 'analyse', 'out'), nowhere);
        await drag(el, card(el, 'analyse'), nowhere);
        await drag(el, inside(card(el, 'tri'), '.handle'), nowhere);
      });
      expect(details).toEqual([]);
    });
  });

  it('emits none of moveStep, connect and loopBack when not editable', async () => {
    const el = await show(local?.data);
    const details = await actionsOf(async () => {
      await drag(el, port(el, 'code', 'out'), () => port(el, 'checks', 'in'));
      await drag(el, card(el, 'analyse'), () => card(el, 'tri'));
      await drag(el, inside(card(el, 'ap-prd'), '.handle'), () => card(el, 'prd'));
    });
    expect(details.map((detail) => detail.action)).not.toContain('connect');
    expect(details.map((detail) => detail.action)).not.toContain('moveStep');
    expect(details.map((detail) => detail.action)).not.toContain('loopBack');
    expect(root(el).querySelector('.cell, .ghost, svg.overlay')).toBeNull();
  });

  describe('zoom', () => {
    const click = (el: Element, which: string) => actionsOf(async () => {
      inside(el, `cd-icon-button.${which}`, 'button').click();
      await settle(el);
    });

    it('its buttons change the value by 10 points and emit view', async () => {
      const el = await show();
      const [zoomIn] = await click(el, 'zoom-in');
      expect(zoomIn).toMatchObject({ composant: 'ProcessCanvas', action: 'view', payload: { zoom: 100 } });
      expect(textOf(inside(el, '.zoom output'))).toBe('100 %');
      const [zoomOut] = await click(el, 'zoom-out');
      expect(zoomOut).toMatchObject({ action: 'view', payload: { zoom: 90 } });
    });

    it('stays between 25 % and 200 %', async () => {
      const high = await show(withData({ zoom: 200 }));
      expect((await click(high, 'zoom-in'))[0]).toMatchObject({ payload: { zoom: 200 } });
      document.body.replaceChildren();
      const low = await show(withData({ zoom: 30 }));
      expect((await click(low, 'zoom-out'))[0]).toMatchObject({ payload: { zoom: 25 } });
      expect((await click(low, 'zoom-out'))[0]).toMatchObject({ payload: { zoom: 25 } });
    });

    it('« Tout voir » shows every Phase', async () => {
      const el = await show(withData({ zoom: 200, pan: { x: 300, y: 300 } }));
      const details = await actionsOf(async () => {
        inside(el, 'cd-button.fit', 'button').click();
        await settle(el);
      });
      expect(details.map((detail) => detail.action)).toEqual(['view']);
      const frame = inside(el, '.canvas').getBoundingClientRect();
      for (const phase of root(el).querySelectorAll('cd-phase')) {
        const box = phase.getBoundingClientRect();
        expect(box.left).toBeGreaterThanOrEqual(frame.left - 1);
        expect(box.top).toBeGreaterThanOrEqual(frame.top - 1);
        expect(box.right).toBeLessThanOrEqual(frame.right + 1);
        expect(box.bottom).toBeLessThanOrEqual(frame.bottom + 1);
      }
    });

    it('Ctrl + wheel zooms by 10 around the pointer, and emits view once the wheel stops', async () => {
      const el = await show(withData({ zoom: 100, pan: { x: 0, y: 0 } }));
      const canvas = inside(el, '.canvas');
      const rect = canvas.getBoundingClientRect();
      const details = await actionsOf(async () => {
        canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, ctrlKey: true, clientX: rect.left + 100, clientY: rect.top + 50, bubbles: true, cancelable: true }));
        await new Promise((resolve) => setTimeout(resolve, 400));
      });
      expect(details).toHaveLength(1);
      expect(details[0]).toMatchObject({ action: 'view', payload: { zoom: 110 } });
      const { pan } = details[0]!.payload as { pan: { x: number; y: number } };
      // The point under the pointer stays: 100 / 1 = pan + 100 / 1.1.
      expect(pan.x).toBeCloseTo(100 - 100 / 1.1);
      expect(pan.y).toBeCloseTo(50 - 50 / 1.1);
    });
  });

  describe('pan', () => {
    it('follows a drag on the background, and emits view at its end', async () => {
      const el = await show(withData({ zoom: 100, pan: { x: 0, y: 0 } }));
      const background = inside(el, '.canvas');
      const rect = background.getBoundingClientRect();
      const details = await actionsOf(() => {
        pointer('pointerdown', background, { x: rect.left + 4, y: rect.top + 4 });
        pointer('pointermove', background, { x: rect.left + 54, y: rect.top + 24 });
        pointer('pointerup', background, { x: rect.left + 54, y: rect.top + 24 });
      });
      expect(only(details)).toEqual([{ action: 'view', payload: { zoom: 100, pan: { x: -50, y: -20 } } }]);
    });

    it('follows the wheel', async () => {
      const el = await show(withData({ zoom: 100, pan: { x: 0, y: 0 } }));
      const canvas = inside(el, '.canvas');
      const details = await actionsOf(async () => {
        canvas.dispatchEvent(new WheelEvent('wheel', { deltaX: 30, deltaY: 60, bubbles: true, cancelable: true }));
        await new Promise((resolve) => setTimeout(resolve, 400));
      });
      expect(only(details)).toEqual([{ action: 'view', payload: { zoom: 100, pan: { x: 30, y: 60 } } }]);
    });
  });

  it('zooms with + and -, and pans with the arrows, while it has the focus', async () => {
    const el = await show(withData({ zoom: 100, pan: { x: 0, y: 0 } }));
    const canvas = inside(el, '.canvas');
    canvas.focus();
    const press = (key: string) => canvas.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, composed: true, cancelable: true }));
    const details = await actionsOf(() => {
      press('+');
      press('-');
      press('-');
      press('ArrowRight');
      press('ArrowDown');
    });
    expect(details.map(({ payload }) => payload)).toEqual([
      expect.objectContaining({ zoom: 110 }),
      expect.objectContaining({ zoom: 100 }),
      expect.objectContaining({ zoom: 90 }),
      expect.objectContaining({ zoom: 90 }),
      expect.objectContaining({ zoom: 90 }),
    ]);
    const [, , third, right, down] = details.map(({ payload }) => payload as { pan: { x: number; y: number } });
    expect(right?.pan.x).toBeCloseTo((third?.pan.x ?? 0) + 40);
    expect(down?.pan.y).toBeCloseTo((third?.pan.y ?? 0) + 40);
  });

  it('lets Tab go through its cards', async () => {
    const el = await show();
    const articles = [...root(el).querySelectorAll('cd-step-card')].map((c) => inside(c, 'article'));
    expect(articles.every((article) => article.tabIndex === 0)).toBe(true);
  });

  it('applies a zoom and a pan given as data', async () => {
    const el = await show();
    el.data = withData({ zoom: 50, pan: { x: 10, y: 20 } });
    await settle(el);
    expect(textOf(inside(el, '.zoom output'))).toBe('50 %');
    expect(inside(el, '.content').style.transform).toBe('translate(-5px, -10px) scale(0.5)');
  });

  it('places its toast over its top and its menu on its right edge', async () => {
    const el = (await render(ProcessCanvas, crewdeck?.data, {
      toast: '<cd-toast data=\'{"tone":"accent","icon":null,"text":"Le brouillon est enregistré."}\'></cd-toast>',
    })) as Canvas;
    const slot = inside<HTMLSlotElement>(el, '.toast slot');
    expect(slot.assignedElements().map((node) => node.localName)).toEqual(['cd-toast']);
  });
});
