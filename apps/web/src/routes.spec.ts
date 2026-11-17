import type { Me } from '@crewdeck/contracts';
import { emitAction, PageComposants } from '@crewdeck/sdk';
import { createDispatcher } from './actions/dispatcher.js';
import { boot } from './app.js';

const PILOT: Me = { id: '018f6b2a-7c3d-7e4f-9a1b-2c3d4e5f6a7b', displayName: 'octocat', avatarUrl: null, timeZone: 'Europe/Paris', gettingStartedStep: 'done', identities: [] };

describe('the page’s routes', () => {
  it('open the library of Composants at /parametres/composants?c=, whose select changes ?c=', async () => {
    history.replaceState(null, '', '/parametres/composants?c=Banner');
    const root = document.createElement('div');
    document.body.append(root);
    const app = await boot({ root, dispatcher: createDispatcher(), me: async () => PILOT });

    const page = root.querySelector('cd-page-composants') as HTMLElement & { data: { selected: { name: string } } };
    expect(page.closest('cd-cadre')).toBe(root.firstElementChild);
    expect(page.data.selected.name).toBe('Banner');

    emitAction(page, PageComposants, 'select', { name: 'Button' });
    expect(location.pathname + location.search).toBe('/parametres/composants?c=Button');
    expect(root.querySelector('cd-page-composants')).toBe(page);
    expect(page.data.selected.name).toBe('Button');
    app.router.stop();
  });
});
