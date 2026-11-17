import { fillPlaced } from './placed.js';

describe('fillPlaced', () => {
  it('gives a node its text, or the nodes of its Emplacements', () => {
    const host = document.createElement('div');
    fillPlaced(host, [
      { tag: 'cd-message', data: { text: 'a' } },
      { tag: 'cd-banner', text: 'Arrêtée' },
      { tag: 'cd-empty', children: [{ tag: 'cd-button', slot: 'actions' }] },
    ]);
    expect([...host.children].map((child) => child.localName)).toEqual(['cd-message', 'cd-banner', 'cd-empty']);
    expect(host.children[1]?.textContent).toBe('Arrêtée');
    expect(host.children[2]?.children[0]?.getAttribute('slot')).toBe('actions');
  });

  it('gives a node both its text and its children, the same elements kept from one call to the next', () => {
    const host = document.createElement('div');
    const node = (text: string) => ({ tag: 'cd-empty', text, children: [{ tag: 'cd-button', slot: 'actions', data: { label: 'Voir' } }] }) as const;
    fillPlaced(host, [node('Chiffrée.')]);
    const empty = host.children[0];
    const button = empty?.children[0];
    expect(empty?.firstChild?.textContent).toBe('Chiffrée.');
    expect(button?.localName).toBe('cd-button');
    fillPlaced(host, [node('Toujours chiffrée.')]);
    expect(host.children[0]).toBe(empty);
    expect(empty?.children[0]).toBe(button);
    expect(empty?.childNodes).toHaveLength(2);
    expect(empty?.firstChild?.textContent).toBe('Toujours chiffrée.');
  });
});
