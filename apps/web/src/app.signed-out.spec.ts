import { createDispatcher } from './actions/dispatcher.js';
import { boot } from './app.js';
import { createStore } from './store/store.js';

describe('the page signed out', () => {
  it('opens no socket and measures nothing: the store waits for a Pilote', async () => {
    history.replaceState(null, '', '/connexion');
    const root = document.createElement('div');
    document.body.append(root);
    const connection = { start: vi.fn<() => void>(), stop: vi.fn<() => void>() };
    const latency = { start: vi.fn<() => void>(), stop: vi.fn<() => void>() };
    const app = await boot({ root, dispatcher: createDispatcher(), me: async () => null, store: createStore(), connection, latency });
    expect(connection.start).not.toHaveBeenCalled();
    expect(latency.start).not.toHaveBeenCalled();
    expect(root.querySelector('cd-banner')).toBeNull();
    app.stop();
  });
});
