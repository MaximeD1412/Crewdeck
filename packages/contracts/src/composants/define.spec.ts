import { z } from 'zod';
import { defineComposant } from './define.js';

const spec = () => ({
  name: 'DecisionRow',
  version: 1,
  tag: 'cd-decision-row' as const,
  category: 'partie' as const,
  description: 'Une ligne de la liste « À toi ».',
  data: z.object({ title: z.string() }),
  actions: { open: z.object({ id: z.string() }) },
  slots: ['actions'] as const,
  examples: [{ name: 'nominal', data: { title: 'Ticket bloqué · #42' }, slots: { actions: '<button>Ouvrir</button>' } }],
});

describe('defineComposant', () => {
  it('returns a frozen declaration', () => {
    const declaration = defineComposant(spec());
    expect(declaration.name).toBe('DecisionRow');
    expect(declaration.tag).toBe('cd-decision-row');
    expect(Object.isFrozen(declaration)).toBe(true);
    expect(Object.isFrozen(declaration.actions)).toBe(true);
    expect(Object.isFrozen(declaration.slots)).toBe(true);
    expect(Object.isFrozen(declaration.examples)).toBe(true);
    expect(Object.isFrozen(declaration.examples[0])).toBe(true);
  });

  it('rejects an example that does not match its data schema', () => {
    expect(() =>
      defineComposant({ ...spec(), examples: [{ name: 'sans titre', data: { title: 42 } as never }] }),
    ).toThrow(/DecisionRow.*sans titre/);
  });

  it('rejects a declaration without examples', () => {
    expect(() => defineComposant({ ...spec(), examples: [] })).toThrow(/DecisionRow/);
  });

  it('rejects an example filling an undeclared slot', () => {
    expect(() =>
      defineComposant({ ...spec(), examples: [{ name: 'intrus', data: { title: 'x' }, slots: { footer: 'x' } as never }] }),
    ).toThrow(/footer/);
  });

  it.each([
    ['a name that is not PascalCase', { name: 'decisionRow' }, /decisionRow/],
    ['a tag outside cd-<kebab>', { tag: 'ui-decision-row' as never }, /ui-decision-row/],
    ['an unknown category', { category: 'widget' as never }, /widget/],
    ['a version that is not a positive integer', { version: 0 }, /version/],
  ] as const)('rejects %s', (_case, override, message) => {
    expect(() => defineComposant({ ...spec(), ...override })).toThrow(message);
  });
});
