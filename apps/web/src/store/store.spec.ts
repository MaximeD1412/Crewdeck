import type { Event, Me, State } from '@crewdeck/contracts';
import { createStore } from './store.js';

const PILOT: Me = { id: '018f6b2a-7c3d-7e4f-9a1b-2c3d4e5f6a7b', login: 'octocat', avatarUrl: null, timeZone: 'Europe/Paris', gettingStartedStep: 'done' };
const AT = '2026-11-11T08:00:00.000Z';

const pilotEvent = (seq: number, login: string): Event => ({ seq, type: 'pilot.upserted', payload: { ...PILOT, login }, at: AT });
const snapshot = (seq: number, pilot: Me = PILOT): State => ({ seq, pilot, runner: null, 'runner-link': null, 'ai-account': [], devices: [] });

const pilotStore = () => {
  const store = createStore();
  store.registerSlice('pilot', { shape: 'single' });
  return store;
};

describe('the store at boot', () => {
  it('is connecting, with no seq, no loss and no slice', () => {
    expect(pilotStore().getState()).toEqual({ seq: null, connection: 'connecting', lostAt: null, slices: {}, vaultState: 'locked' });
  });
});

describe('applyEvent', () => {
  it('applies the event that follows the seq: seq n + 1', () => {
    const store = pilotStore();
    store.applySnapshot(snapshot(4));

    expect(store.applyEvent(pilotEvent(5, 'renamed'))).toBe('applied');
    expect(store.getState().seq).toBe(5n);
    expect(store.getState().slices.pilot).toEqual({ ...PILOT, login: 'renamed' });
  });
});

describe('applyEvent, around the seq', () => {
  it.each([4, 3, 0])('ignores an event already applied: seq %i <= 4, the state unchanged', (seq) => {
    const store = pilotStore();
    store.applySnapshot(snapshot(4));
    const before = store.getState();

    expect(store.applyEvent(pilotEvent(seq, 'stale'))).toBe('ignored');
    expect(store.getState()).toBe(before);
  });

  it('on a skipped seq (n + 2), applies nothing and switches to resync, with the time of the loss', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-11T14:12:00.000Z'));
    try {
      const store = pilotStore();
      store.applySnapshot(snapshot(4));
      store.markLive();

      expect(store.applyEvent(pilotEvent(6, 'too-far'))).toBe('gap');
      expect(store.getState()).toEqual({
        seq: 4n,
        connection: 'resync',
        lostAt: new Date('2026-11-11T14:12:00.000Z'),
        slices: { pilot: PILOT },
        vaultState: 'locked',
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('ignores an event before any snapshot', () => {
    const store = pilotStore();
    expect(store.applyEvent(pilotEvent(1, 'early'))).toBe('ignored');
    expect(store.getState().seq).toBeNull();
  });

  it('moves the seq on for a resource no slice holds', () => {
    const store = pilotStore();
    store.applySnapshot(snapshot(4));

    expect(store.applyEvent({ seq: 5, type: 'idea.removed', payload: { id: PILOT.id }, at: AT })).toBe('applied');
    expect(store.getState()).toMatchObject({ seq: 5n, slices: { pilot: PILOT } });
  });
});

describe('the slices', () => {
  const IDEA_A = { id: '019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6a01', title: 'a' };
  const IDEA_B = { id: '019a6b2c-3d4e-7f00-8a1b-2c3d4e5f6a02', title: 'b' };

  it('a single one is replaced by its upserted event and emptied by its removed one', () => {
    const store = pilotStore();
    store.applySnapshot(snapshot(1));
    store.applyEvent(pilotEvent(2, 'renamed'));
    expect(store.getState().slices.pilot).toEqual({ ...PILOT, login: 'renamed' });

    store.applyEvent({ seq: 3, type: 'pilot.removed', payload: { id: PILOT.id }, at: AT });
    expect(store.getState().slices.pilot).toBeNull();
  });

  it('a collection is a map by id: the snapshot fills it, upserted sets by id, removed deletes', () => {
    // A collection's resource registers its event payload and its snapshot key with its ticket: here, through casts.
    const store = createStore();
    store.registerSlice('idea', { shape: 'collection' });
    store.applySnapshot({ seq: 1, pilot: PILOT, idea: [IDEA_A] } as unknown as State);
    const slice = () => (store.getState().slices as unknown as { idea: ReadonlyMap<string, unknown> }).idea;
    expect([...slice()]).toEqual([[IDEA_A.id, IDEA_A]]);

    const before = slice();
    store.applyEvent({ seq: 2, type: 'idea.upserted', payload: IDEA_B, at: AT });
    store.applyEvent({ seq: 3, type: 'idea.upserted', payload: { ...IDEA_A, title: 'a2' }, at: AT });
    expect([...slice()]).toEqual([
      [IDEA_A.id, { ...IDEA_A, title: 'a2' }],
      [IDEA_B.id, IDEA_B],
    ]);
    expect([...before]).toEqual([[IDEA_A.id, IDEA_A]]);

    store.applyEvent({ seq: 4, type: 'idea.removed', payload: { id: IDEA_A.id }, at: AT });
    expect([...slice()]).toEqual([[IDEA_B.id, IDEA_B]]);
  });

  it('a slice is registered once', () => {
    const store = pilotStore();
    expect(() => store.registerSlice('pilot', { shape: 'single' })).toThrow(/pilot/);
  });
});

describe('applySnapshot', () => {
  it('replaces the seq and every slice, even with an older seq, and keeps the connection', () => {
    const store = pilotStore();
    store.applySnapshot(snapshot(9, { ...PILOT, login: 'before' }));
    store.applySnapshot(snapshot(3));
    expect(store.getState()).toEqual({ seq: 3n, connection: 'connecting', lostAt: null, slices: { pilot: PILOT }, vaultState: 'locked' });
  });
});

describe('a slice under another key of the snapshot', () => {
  it('reads the Appareils from `devices`, then their `device.*` events', () => {
    const store = createStore();
    store.registerSlice('device', { shape: 'collection', snapshotKey: 'devices' });
    const device = { id: '018f6b2a-7c3d-7e4f-9a1b-2c3d4e5f6a74', name: 'Chrome sur Linux', state: 'pending', approvedAt: null, revokedAt: null, lastSeenAt: null, current: true } as const;
    store.applySnapshot({ ...snapshot(1), devices: [device] });
    expect([...(store.getState().slices.device ?? [])]).toEqual([[device.id, device]]);

    store.applyEvent({ seq: 2, type: 'device.upserted', payload: { ...device, state: 'trusted', approvedAt: AT, current: false }, at: AT });
    expect(store.getState().slices.device?.get(device.id)).toMatchObject({ state: 'trusted' });
  });
});

describe('the vault state', () => {
  it('is locked at boot, then what the vault says, each change told once', () => {
    const store = pilotStore();
    const seen: string[] = [];
    store.subscribe((state) => seen.push(state.vaultState));
    store.setVaultState('unlocked');
    store.setVaultState('unlocked');
    store.setVaultState('no-device');
    expect(seen).toEqual(['unlocked', 'no-device']);
  });
});

describe('the connection of the state', () => {
  it('keeps the time of the first loss until live, then forgets it', () => {
    const store = pilotStore();
    store.markLost(new Date('2026-11-11T14:12:00.000Z'));
    store.markLost(new Date('2026-11-11T14:13:00.000Z'));
    expect(store.getState()).toMatchObject({ connection: 'resync', lostAt: new Date('2026-11-11T14:12:00.000Z') });

    store.markLive();
    expect(store.getState()).toMatchObject({ connection: 'live', lostAt: null });
    store.markLost(new Date('2026-11-11T15:00:00.000Z'));
    expect(store.getState().lostAt).toEqual(new Date('2026-11-11T15:00:00.000Z'));
  });

  it('markStale: resync while the page catches up, with no time of loss (the socket was not lost), until live', () => {
    const store = pilotStore();
    store.markLive();
    store.markStale();
    expect(store.getState()).toMatchObject({ connection: 'resync', lostAt: null });

    store.markLost(new Date('2026-11-11T14:12:00.000Z'));
    store.markStale();
    expect(store.getState()).toMatchObject({ connection: 'resync', lostAt: new Date('2026-11-11T14:12:00.000Z') });

    store.markLive();
    expect(store.getState()).toMatchObject({ connection: 'live', lostAt: null });
  });

  it('tells its subscribers each new state, until they stop', () => {
    const store = pilotStore();
    const seen: string[] = [];
    const stop = store.subscribe((state) => seen.push(state.connection));
    store.markLost(new Date());
    store.markLive();
    stop();
    store.markLost(new Date());
    expect(seen).toEqual(['resync', 'live']);
  });
});

describe('onEvent', () => {
  it('tells each applied event, live once the store is live, never an ignored one or a gap', () => {
    const store = pilotStore();
    store.applySnapshot(snapshot(4));
    const seen: [number, boolean][] = [];
    const stop = store.onEvent((event, live) => seen.push([event.seq, live]));

    store.applyEvent(pilotEvent(5, 'replayed'));
    store.markLive();
    store.applyEvent(pilotEvent(6, 'live'));
    store.applyEvent(pilotEvent(6, 'again'));
    store.applyEvent(pilotEvent(9, 'gap'));
    stop();
    store.markLive();
    store.applyEvent(pilotEvent(7, 'after stop'));

    expect(seen).toEqual([
      [5, false],
      [6, true],
    ]);
  });
});
