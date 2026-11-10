import { t } from '@crewdeck/sdk';
import { createDispatcher } from './actions/dispatcher.js';
import { boot } from './app.js';

describe('the page', () => {
  it('boots the default Skin, listens to cd-action on the document and renders PageIntrouvable for an unknown URL', async () => {
    history.replaceState(null, '', '/nope');
    const root = document.createElement('main');
    document.body.append(root);

    const dispatcher = createDispatcher();
    const listen = vi.spyOn(dispatcher, 'listen');

    const app = await boot({ root, dispatcher });

    expect(listen).toHaveBeenCalledWith(document);

    const page = root.firstElementChild as HTMLElement & { updateComplete: Promise<unknown> };
    expect(page.localName).toBe('cd-page-introuvable');
    expect(customElements.get('cd-page-introuvable')).toBeDefined();
    await page.updateComplete;
    expect(page.shadowRoot?.querySelector('h1')?.textContent).toBe(t('router.notFound.title'));
    app.router.stop();
  });
});
