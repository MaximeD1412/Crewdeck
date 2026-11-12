import { defineComposant, defineSkin, type Skin } from '@crewdeck/sdk';
import { z } from 'zod';
import { CONFIRM_TAG, CrewdeckConfirm } from './dialogs/confirm.js';
import main from './main.ts?raw';
import { bootSkin } from './registry.js';

let run = 0;

/** Two declarations with tags of their own: a document defines a tag once. */
const declarations = () => {
  run += 1;
  const declare = (name: string) =>
    defineComposant({
      name,
      version: 1,
      tag: `cd-${name.toLowerCase()}-${run}`,
      category: 'partie',
      description: name,
      data: z.object({}),
      actions: {},
      slots: [],
      examples: [{ name: 'nominal', data: {} }],
    });
  return { Ligne: declare('Ligne'), Carte: declare('Carte') };
};

const element = () => class extends HTMLElement {};

describe('bootSkin', () => {
  it("defines the child's implementation for the Composant it replaces and the parent's for the others", async () => {
    const all = declarations();
    const parentLigne = element();
    const parentCarte = element();
    const childCarte = element();
    const parent = defineSkin({ id: 'parent', parent: null, targets: ['pc'], composants: { Ligne: parentLigne, Carte: parentCarte } as never });
    const child = defineSkin({ id: 'enfant', parent: 'parent', targets: ['pc'], composants: { Carte: childCarte } as never });
    const resolveParent = vi.fn(async (id: string): Promise<Skin> => {
      if (id !== 'parent') throw new Error(id);
      return parent;
    });

    await bootSkin(child, resolveParent, { declarations: all });

    expect(customElements.get(all.Ligne.tag)).toBe(parentLigne);
    expect(customElements.get(all.Carte.tag)).toBe(childCarte);
    expect(resolveParent).toHaveBeenCalledWith('parent');
  });

  it('fails the boot with the names of the missing implementations, defining nothing', async () => {
    const all = declarations();
    const skin = defineSkin({ id: 'incomplete', parent: null, targets: ['pc'], composants: {} });

    await expect(bootSkin(skin, async () => skin, { declarations: all })).rejects.toThrow(/Ligne, Carte|Carte, Ligne/);
    expect(customElements.get(all.Ligne.tag)).toBeUndefined();
  });

  it('fails the boot on a Composant no declaration knows', async () => {
    const all = declarations();
    const skin = defineSkin({
      id: 'intrus',
      parent: null,
      targets: ['pc'],
      composants: { Ligne: element(), Carte: element(), Fantome: element() } as never,
    });

    await expect(bootSkin(skin, async () => skin, { declarations: all })).rejects.toThrow(/Fantome/);
  });

  it('keeps crewdeck-confirm the core’s: a Skin’s ConfirmDialog fails its boot, its own define of the tag throws', async () => {
    const all = declarations();
    const skin = defineSkin({
      id: 'usurpateur',
      parent: null,
      targets: ['pc'],
      composants: { Ligne: element(), Carte: element(), ConfirmDialog: element() } as never,
    });

    await expect(bootSkin(skin, async () => skin, { declarations: all })).rejects.toThrow(/ConfirmDialog/);
    expect(() => customElements.define(CONFIRM_TAG, element())).toThrow();
    expect(customElements.get(CONFIRM_TAG)).toBe(CrewdeckConfirm);
  });

  it('defines crewdeck-confirm before any Skin’s module evaluates: main imports it before the app', () => {
    const imports = [...main.matchAll(/^import .*'(.+)';$/gm)].map((m) => m[1]);
    expect(imports.indexOf('./dialogs/confirm.js')).toBeGreaterThan(-1);
    expect(imports.indexOf('./dialogs/confirm.js')).toBeLessThan(imports.findIndex((path) => path.endsWith('/app.js')));
  });

  it('fails the boot on a cycle of parents', async () => {
    const all = declarations();
    const a = defineSkin({ id: 'a', parent: 'b', targets: ['pc'], composants: {} });
    const b = defineSkin({ id: 'b', parent: 'a', targets: ['pc'], composants: {} });

    await expect(bootSkin(a, async (id) => (id === 'a' ? a : b), { declarations: all })).rejects.toThrow(/a.*b.*a/);
  });
});
