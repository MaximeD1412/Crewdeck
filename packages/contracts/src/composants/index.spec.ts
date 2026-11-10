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

  it('declares PageIntrouvable as a page with no data', () => {
    expect(COMPOSANTS.PageIntrouvable).toMatchObject({ tag: 'cd-page-introuvable', category: 'page', slots: [] });
    expect(COMPOSANTS.PageIntrouvable.data.parse({})).toEqual({});
  });
});
