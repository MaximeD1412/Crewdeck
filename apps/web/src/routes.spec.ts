import { emitAction, PageComposants } from '@crewdeck/sdk';
import { createDispatcher } from './actions/dispatcher.js';
import { boot } from './app.js';

describe('the page’s routes', () => {
  it('open the library of Composants at /parametres/composants?c=, whose select changes ?c=', async () => {
    history.replaceState(null, '', '/parametres/composants?c=Banner');
    const root = document.createElement('main');
    document.body.append(root);
    const app = await boot({ root, dispatcher: createDispatcher() });

    const page = root.firstElementChild as HTMLElement & { data: { selected: { name: string } } };
    expect(page.localName).toBe('cd-page-composants');
    expect(page.data.selected.name).toBe('Banner');

    emitAction(page, PageComposants, 'select', { name: 'Button' });
    expect(location.pathname + location.search).toBe('/parametres/composants?c=Button');
    expect(root.firstElementChild).toBe(page);
    expect(page.data.selected.name).toBe('Button');
    app.router.stop();
  });
});
