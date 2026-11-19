import { NOTIFICATION_ICON, notificationOf, openPage, urlOf, type ClientsLike, type WindowLike } from './handlers.js';

const ORIGIN = 'https://crewdeck.example';

describe('the service worker’s notification', () => {
  it('shows the push’s title, keeps its page and replaces an earlier one of its tag', () => {
    expect(notificationOf(JSON.stringify({ title: 'Valider la Conception de Recherche', url: '/conceptions/42', tag: '019a' }))).toEqual({
      title: 'Valider la Conception de Recherche',
      options: { tag: '019a', icon: NOTIFICATION_ICON, data: { url: '/conceptions/42' } },
    });
  });

  it('still shows « Crewdeck » at « À toi » for a push it cannot read', () => {
    const fallback = { title: 'Crewdeck', options: { tag: 'crewdeck', icon: NOTIFICATION_ICON, data: { url: '/a-toi' } } };
    expect(notificationOf(null)).toEqual(fallback);
    expect(notificationOf('not json')).toEqual(fallback);
    expect(notificationOf(JSON.stringify({ title: 'x', url: 'https://elsewhere.example/', tag: 't' }))).toEqual(fallback);
  });
});

describe('the page a tap opens', () => {
  it('is the notification’s, on the worker’s origin only', () => {
    expect(urlOf({ url: '/tickets/44' }, ORIGIN)).toBe(`${ORIGIN}/tickets/44`);
    expect(urlOf({ url: '//elsewhere.example/x' }, ORIGIN)).toBe(`${ORIGIN}/a-toi`);
    expect(urlOf(null, ORIGIN)).toBe(`${ORIGIN}/a-toi`);
  });

  const windowAt = (url: string) => {
    const self: WindowLike & { navigate: ReturnType<typeof vi.fn> } = {
      url,
      focus: vi.fn(async () => self),
      navigate: vi.fn(async () => self),
    };
    return self;
  };
  const clientsOf = (windows: readonly WindowLike[]) => ({
    matchAll: vi.fn(async () => windows),
    openWindow: vi.fn(async () => null),
  }) satisfies ClientsLike;

  it('focuses a Crewdeck window already open and leads it there', async () => {
    const open = windowAt(`${ORIGIN}/boucle`);
    const clients = clientsOf([windowAt('https://elsewhere.example/'), open]);
    await openPage(clients, `${ORIGIN}/tickets/44`);
    expect(open.focus).toHaveBeenCalled();
    expect(open.navigate).toHaveBeenCalledWith(`${ORIGIN}/tickets/44`);
    expect(clients.openWindow).not.toHaveBeenCalled();
  });

  it('opens a window there when none is open', async () => {
    const clients = clientsOf([]);
    await openPage(clients, `${ORIGIN}/a-toi`);
    expect(clients.openWindow).toHaveBeenCalledWith(`${ORIGIN}/a-toi`);
  });
});
