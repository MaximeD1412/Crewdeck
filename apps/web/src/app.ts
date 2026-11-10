import { html, render } from 'lit';

/** The page's core; UI-1's router replaces this placeholder. */
export const renderApp = (root: HTMLElement): void => {
  render(html`<p>Crewdeck</p>`, root);
};
