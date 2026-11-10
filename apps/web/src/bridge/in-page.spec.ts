import { createInPageBridge } from './in-page.js';

describe('the in-page bridge', () => {
  it('gives a subscriber the data known so far, then each change, until it unsubscribes', () => {
    const bridge = createInPageBridge({ dispatch: vi.fn() });
    bridge.publish('page', { n: 1 });
    const seen: unknown[] = [];
    const unsubscribe = bridge.subscribe('page', (data) => seen.push(data));
    bridge.publish('page', { n: 2 });
    bridge.publish('other', { n: 9 });
    unsubscribe();
    bridge.publish('page', { n: 3 });
    expect(seen).toEqual([{ n: 1 }, { n: 2 }]);
  });

  it("pushes a topic's data to an element's data property", () => {
    const bridge = createInPageBridge({ dispatch: vi.fn() });
    const el = document.createElement('div') as HTMLElement & { data?: unknown };
    const unbind = bridge.bind(el, 'page');
    bridge.publish('page', { title: 'À toi' });
    expect(el.data).toEqual({ title: 'À toi' });
    unbind();
    bridge.publish('page', { title: 'Idées' });
    expect(el.data).toEqual({ title: 'À toi' });
  });

  it("hands an action to the core's dispatcher", () => {
    const dispatch = vi.fn();
    const bridge = createInPageBridge({ dispatch });
    const detail = { composant: 'PageIntrouvable', action: 'open', payload: {} };
    bridge.act(detail);
    expect(dispatch).toHaveBeenCalledWith(detail);
  });
});
