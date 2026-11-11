import { placed } from './placed.js';

describe('placed', () => {
  it('writes a Composant with its data as a JSON attribute a parser reads back', () => {
    expect(placed('cd-message', { text: "l'agent & co" }, 'composer')).toBe(
      `<cd-message slot="composer" data='{"text":"l&#39;agent &amp; co"}'></cd-message>`,
    );
  });

  it('puts the markup of its own Emplacements inside it', () => {
    expect(placed('cd-empty', { title: 'Rien' }, undefined, 'Un texte')).toBe(`<cd-empty data='{"title":"Rien"}'>Un texte</cd-empty>`);
  });
});
