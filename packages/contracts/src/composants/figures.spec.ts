import { Capture, Timeline, UsageMeter } from './index.js';

describe('the Composants of tracks and figures', () => {
  const [capture] = Capture.examples;
  const [timeline] = Timeline.examples;
  const [meter] = UsageMeter.examples;

  it.each(['https://example.com/capture.png', '//cdn.example.com/a.png', '/captures/a.png'])(
    'refuses a Capture whose src %s is a remote address the Composant would fetch',
    (src) => {
      expect(Capture.data.safeParse({ ...capture?.data, src }).success).toBe(false);
      expect(Capture.actions.open.safeParse({ src }).success).toBe(false);
    },
  );

  it('takes a Capture from an object URL', () => {
    expect(Capture.data.safeParse({ ...capture?.data, src: 'blob:http://localhost:5173/0b8a' }).success).toBe(true);
  });

  it('refuses a Timeline row past the last week', () => {
    const data = timeline?.data;
    const rows = [{ label: 'Rappels', start: 4, span: 3, tone: 'caution', meta: null, detail: null }];
    expect(Timeline.data.safeParse({ ...data, rows }).success).toBe(false);
    expect(Timeline.data.safeParse({ ...data, rows: [{ ...rows[0], span: 2 }] }).success).toBe(true);
  });

  it.each([-1, 101])('refuses a UsageMeter at %s %%', (value) => {
    expect(UsageMeter.data.safeParse({ ...meter?.data, value }).success).toBe(false);
  });
});
