import { renderApp } from './app.js';

describe('the page', () => {
  it('renders the product name', () => {
    const root = document.createElement('main');
    renderApp(root);
    expect(root.querySelector('p')?.textContent).toBe('Crewdeck');
  });
});
