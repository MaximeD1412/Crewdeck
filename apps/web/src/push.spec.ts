import { PUSH_LABEL_MAX } from '@crewdeck/contracts';
import { canPush, pushLabelOf } from './push.js';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';
const CHROME_WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const FIREFOX_LINUX = 'Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0';
const CHROME_ANDROID = 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
const SAFARI_MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15';

describe('pushLabelOf', () => {
  it('names the browser and its system, « Safari · iPhone »', () => {
    expect(pushLabelOf(IPHONE)).toBe('Safari · iPhone');
    expect(pushLabelOf(CHROME_WINDOWS)).toBe('Chrome · Windows');
    expect(pushLabelOf(FIREFOX_LINUX)).toBe('Firefox · Linux');
    expect(pushLabelOf(CHROME_ANDROID)).toBe('Chrome · Android');
    expect(pushLabelOf(SAFARI_MAC)).toBe('Safari · Mac');
  });

  it('stays within the label’s bound', () => {
    expect(pushLabelOf('').length).toBeGreaterThan(0);
    expect(pushLabelOf('x'.repeat(500)).length).toBeLessThanOrEqual(PUSH_LABEL_MAX);
  });
});

type FakeWindow = { navigator: Record<string, unknown>; matchMedia: (query: string) => { matches: boolean }; PushManager?: unknown; Notification?: unknown };

const windowOf = ({ userAgent = CHROME_WINDOWS, push = true, standalone = false } = {}) =>
  ({
    navigator: { userAgent, ...(push ? { serviceWorker: {} } : {}), ...(standalone ? { standalone: true } : {}) },
    matchMedia: () => ({ matches: false }),
    ...(push ? { PushManager: class {}, Notification: class {} } : {}),
  }) satisfies FakeWindow as unknown as Window;

describe('canPush', () => {
  it('needs a service worker, PushManager and Notification', () => {
    expect(canPush(windowOf())).toBe(true);
    expect(canPush(windowOf({ push: false }))).toBe(false);
  });

  it('on an iPhone, only as the home-screen app', () => {
    expect(canPush(windowOf({ userAgent: IPHONE }))).toBe(false);
    expect(canPush(windowOf({ userAgent: IPHONE, standalone: true }))).toBe(true);
  });
});
