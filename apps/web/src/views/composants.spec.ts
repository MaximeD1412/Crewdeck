import { COMPOSANTS, defineComposant, PageComposants, t, zIconName, zTone } from '@crewdeck/sdk';
import { z } from 'zod';
import { composantsView, typeOf } from './composants.js';

describe('composantsView', () => {
  it('lists every Composant by category, in the order cadre, page, partie, signal, by name', () => {
    const view = composantsView(COMPOSANTS, null);
    expect(view.groups.map((group) => group.category)).toEqual(['cadre', 'page', 'partie', 'signal']);
    expect(view.groups.flatMap((group) => group.composants.map((entry) => entry.name)).sort()).toEqual(
      Object.keys(COMPOSANTS).sort(),
    );
    expect(view.groups[0]?.composants).toEqual([
      { name: 'PageHeader', version: 1 },
      { name: 'ProjectFilter', version: 1 },
    ]);
    expect(view.groups[3]?.composants.map((entry) => entry.name)).toEqual([
      'Banner',
      'Button',
      'Checkbox',
      'Chip',
      'Empty',
      'Icon',
      'IconButton',
      'Radio',
      'Select',
      'StatusBadge',
      'StatusDot',
      'Tabs',
      'TextField',
      'Toggle',
    ]);
  });

  it('with ?c=Banner, gives Banner: its examples, its fields with their types and descriptions, its Emplacements', () => {
    const { selected } = composantsView(COMPOSANTS, 'Banner');
    expect(selected).toMatchObject({
      name: 'Banner',
      version: 1,
      tag: 'cd-banner',
      category: 'signal',
      description: t('composants.Banner.description'),
      actions: [],
      examples: COMPOSANTS.Banner.examples,
    });
    expect(selected.fields).toEqual([
      { name: 'tone', type: 'Tone', description: t('composants.Banner.data.tone') },
      { name: 'title', type: 'string', description: t('composants.Banner.data.title') },
      { name: 'icon', type: 'IconName | undefined', description: t('composants.Banner.data.icon') },
    ]);
    expect(selected.slots).toEqual([
      { name: 'default', description: t('composants.Banner.slots.default') },
      { name: 'actions', description: t('composants.Banner.slots.actions') },
    ]);
  });

  it('gives the actions with their description, free until the Actions sensibles are declared (CORE-7)', () => {
    expect(composantsView(COMPOSANTS, 'Tabs').selected.actions).toEqual([
      { name: 'select', sensitive: false, description: t('composants.Tabs.actions.select') },
    ]);
  });

  it.each([null, 'Nope', 'constructor'])('with ?c=%s, opens the first Composant of the catalogue', (name) => {
    expect(composantsView(COMPOSANTS, name).selected.name).toBe('PageHeader');
  });

  it('is the data of PageComposants', () => {
    for (const name of Object.keys(COMPOSANTS)) {
      expect(PageComposants.data.safeParse(composantsView(COMPOSANTS, name)).success, name).toBe(true);
    }
  });

  it('documents a field without its key in the catalogue as missing, never as a crash', () => {
    const Probe = defineComposant({
      name: 'Probe',
      version: 2,
      tag: 'cd-probe',
      category: 'partie',
      description: 'Une sonde.',
      data: z.object({ title: z.string() }),
      actions: {},
      slots: [],
      examples: [{ name: 'nominal', data: { title: 'x' } }],
    });
    const { selected } = composantsView({ Probe }, 'Probe');
    expect(selected).toMatchObject({ description: 'Une sonde.', fields: [{ name: 'title', type: 'string', description: '' }] });
  });
});

describe('typeOf', () => {
  it.each([
    [z.string(), 'string'],
    [z.number().int().nonnegative(), 'number'],
    [z.boolean(), 'boolean'],
    [zIconName, 'IconName'],
    [zTone.optional(), 'Tone | undefined'],
    [z.enum(['md', 'sm']), "'md' | 'sm'"],
    [z.array(z.string()), 'string[]'],
    [z.array(z.object({ id: z.string(), label: z.string() })), '{ id, label }[]'],
    [z.uuid({ version: 'v7' }).nullable(), 'uuid | null'],
    [z.record(z.string(), z.unknown()), 'Record<string, unknown>'],
    [z.object({ label: z.string(), href: z.string() }).optional(), '{ label, href } | undefined'],
    [z.literal('a'), "'a'"],
    [z.union([z.string(), z.number()]), 'string | number'],
  ] as const)('of %s is %s', (schema, expected) => {
    expect(typeOf(schema)).toBe(expected);
  });
});
