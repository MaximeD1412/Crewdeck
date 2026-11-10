import { defineSkin } from './skin.js';

describe('defineSkin', () => {
  it('returns a frozen Skin', () => {
    const PageIntrouvable = class extends EventTarget {} as unknown as CustomElementConstructor;
    const skin = defineSkin({ id: 'passerelle', parent: null, targets: ['pc', 'telephone'], composants: { PageIntrouvable } });
    expect(skin).toEqual({ id: 'passerelle', parent: null, targets: ['pc', 'telephone'], composants: { PageIntrouvable } });
    expect(Object.isFrozen(skin)).toBe(true);
    expect(Object.isFrozen(skin.composants)).toBe(true);
    expect(Object.isFrozen(skin.targets)).toBe(true);
  });

  it('rejects a Skin without a target', () => {
    expect(() => defineSkin({ id: 'vide', parent: null, targets: [], composants: {} })).toThrow(/vide/);
  });
});
