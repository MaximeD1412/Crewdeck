import { COMPOSANTS } from './index.js';

describe('COMPOSANTS', () => {
  const declarations = Object.entries(COMPOSANTS);

  it('keys every declaration by its name', () => {
    for (const [key, declaration] of declarations) expect(declaration.name).toBe(key);
  });

  it('gives each Composant its own tag', () => {
    const tags = declarations.map(([, declaration]) => declaration.tag);
    expect(new Set(tags).size).toBe(tags.length);
  });

  it.each([
    ['cadre', ['PageHeader', 'ProjectFilter']],
    ['page', ['PageComposants', 'PageIntrouvable']],
    ['partie', ['AgentRow', 'Capture', 'Card', 'CheckRow', 'CodeBlock', 'DecisionRow', 'IdeaRow', 'KeyValue', 'ListRow', 'ProcessTrack', 'Stat', 'TicketRow', 'TicketTree', 'Timeline', 'UsageMeter']],
    ['signal', ['Banner', 'Button', 'Chip', 'Empty', 'Icon', 'IconButton', 'StatusBadge', 'StatusDot', 'Tabs']],
  ])('puts the base Composants of %s in their category', (category, names) => {
    for (const name of names) expect(COMPOSANTS[name as keyof typeof COMPOSANTS].category, name).toBe(category);
  });

  it('gives each Composant the tag of its name in kebab case', () => {
    for (const [name, declaration] of declarations) {
      expect(declaration.tag).toBe(`cd-${name.replace(/(?<!^)[A-Z]/g, (c) => `-${c}`).toLowerCase()}`);
    }
  });

  it('declares PageIntrouvable as a page with no data', () => {
    expect(COMPOSANTS.PageIntrouvable).toMatchObject({ tag: 'cd-page-introuvable', category: 'page', slots: [] });
    expect(COMPOSANTS.PageIntrouvable.data.parse({})).toEqual({});
  });
});
