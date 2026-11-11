import { CD_ACTION, t } from '@crewdeck/sdk';
import { createDispatcher } from './actions/dispatcher.js';
import { boot } from './app.js';

type WithData = HTMLElement & { data: unknown; updateComplete: Promise<unknown> };

describe('the page', () => {
  afterEach(() => document.body.replaceChildren());

  it('boots the default Skin, listens to cd-action on the document, renders PageIntrouvable for an unknown URL inside the Cadre, which follows the page and whose openPilot leads to /parametres', async () => {
    history.replaceState(null, '', '/nope');
    const root = document.createElement('div');
    document.body.append(root);

    const dispatcher = createDispatcher();
    const listen = vi.spyOn(dispatcher, 'listen');

    const app = await boot({ root, dispatcher });

    expect(listen).toHaveBeenCalledWith(document);

    const cadre = root.firstElementChild as WithData;
    expect(cadre.localName).toBe('cd-cadre');
    expect(cadre.data).toMatchObject({ variant: 'default', current: null });
    expect(cadre.querySelectorAll(':scope > cd-menu-item[slot=menu]')).toHaveLength(9);
    const page = cadre.querySelector('cd-page-introuvable') as WithData;
    expect(customElements.get('cd-page-introuvable')).toBeDefined();
    await page.updateComplete;
    expect(page.shadowRoot?.querySelector('h1')?.textContent).toBe(t('router.notFound.title'));

    // The Cadre follows the page; its Pilote's avatar leads to /parametres.
    app.router.navigate('/idees');
    expect(cadre.data).toMatchObject({ current: 'idees' });

    cadre.dispatchEvent(
      new CustomEvent(CD_ACTION, { bubbles: true, composed: true, detail: { composant: 'Cadre', action: 'openPilot', payload: {} } }),
    );
    await vi.waitFor(() => expect(location.pathname).toBe('/parametres'));
    expect(cadre.data).toMatchObject({ current: 'parametres' });
    app.router.stop();
  });
});
