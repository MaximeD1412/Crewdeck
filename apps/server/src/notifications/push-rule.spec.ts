import { TabPresence } from '../realtime/tab-presence.js';
import type { PushDelivery, PushResult } from './push-delivery.js';
import { PUSH_AFTER_MS, PUSH_RETRIES, PUSH_RETRY_MS, PushRule } from './push-rule.js';

const PILOT = '019a6b2c-0000-7000-8000-000000000001';
const OTHER = '019a6b2c-0000-7000-8000-000000000002';
const A = '019a6b2c-0000-7000-8000-00000000000a';
const B = '019a6b2c-0000-7000-8000-00000000000b';

/**
 * The rule against the real presence and the fake clock of Vitest, its
 * delivery a fake of the database's: the Décisions raised and still waiting
 * (open, neither pushed nor seen) survive a restart of the rule, as rows do.
 * `outcomes` are what the pushes give in turn, `done` once they run out.
 */
const setUp = (outcomes: PushResult[] = []) => {
  const waiting = new Map<string, { id: string; at: number }[]>();
  const pushed: [string, string[]][] = [];
  const tries: string[] = [];
  const delivery = {
    push: (pilotId: string): Promise<PushResult> => {
      tries.push(pilotId);
      const result = outcomes.shift() ?? 'done';
      const ids = (waiting.get(pilotId) ?? []).map(({ id }) => id);
      if (result === 'done' && ids.length > 0) {
        waiting.delete(pilotId);
        pushed.push([pilotId, ids]);
      }
      return Promise.resolve(result);
    },
    seen: (pilotId: string, at: Date): Promise<void> => {
      waiting.set(
        pilotId,
        (waiting.get(pilotId) ?? []).filter((decision) => decision.at >= at.getTime()),
      );
      return Promise.resolve();
    },
  } as unknown as PushDelivery;
  const start = () => {
    const presence = new TabPresence();
    const rule = new PushRule(presence, delivery);
    rule.onModuleInit();
    return { presence, rule };
  };
  const world = { ...start(), pushed, tries };
  return {
    world,
    /** A Décision committed for `pilotId`, then told to the rule. */
    raise: (pilotId: string, id: string) => {
      waiting.set(pilotId, [...(waiting.get(pilotId) ?? []), { id, at: Date.now() }]);
      world.rule.created(pilotId);
    },
    /** The server restarted: a new presence and a new rule, the rows kept. */
    restart: () => {
      world.rule.onModuleDestroy();
      Object.assign(world, start());
    },
  };
};

const minutes = (n: number) => vi.advanceTimersByTimeAsync(n * 60_000);

describe('PushRule', () => {
  beforeEach(() => vi.useFakeTimers({ now: new Date('2026-11-16T10:00:00Z') }));
  afterEach(() => vi.useRealTimers());

  it('waits 2 minutes, tries a push that reached no browser again 3 times, 5 minutes apart', () => {
    expect([PUSH_AFTER_MS, PUSH_RETRY_MS, PUSH_RETRIES]).toEqual([120_000, 300_000, 3]);
  });

  it('pushes a Décision at once when the Pilote has no tab open', async () => {
    const { world, raise } = setUp();
    raise(PILOT, A);
    await minutes(0);
    expect(world.pushed).toEqual([[PILOT, [A]]]);
  });

  it('pushes at once when the tabs open have all been hidden for 2 minutes', async () => {
    const { world, raise } = setUp();
    const tab = {};
    world.presence.open(PILOT, tab);
    world.presence.setVisibility(PILOT, tab, true);
    world.presence.setVisibility(PILOT, tab, false);
    await minutes(2);
    raise(PILOT, A);
    await minutes(0);
    expect(world.pushed).toEqual([[PILOT, [A]]]);
  });

  it('does not push while a tab is visible, then pushes what waits 2 minutes after the last visible tab hides', async () => {
    const { world, raise } = setUp();
    const [first, second] = [{}, {}];
    world.presence.open(PILOT, first);
    world.presence.setVisibility(PILOT, first, true);
    world.presence.open(PILOT, second);
    world.presence.setVisibility(PILOT, second, true);
    raise(PILOT, A);
    world.presence.setVisibility(PILOT, first, false);
    await minutes(5);
    expect(world.pushed).toEqual([]);
    world.presence.close(PILOT, second);
    await minutes(1);
    expect(world.pushed).toEqual([]);
    await minutes(1);
    expect(world.pushed).toEqual([[PILOT, [A]]]);
    await minutes(10);
    expect(world.pushed).toEqual([[PILOT, [A]]]);
  });

  it('waits out the 2 minutes of a tab hidden just before the Décision', async () => {
    const { world, raise } = setUp();
    const tab = {};
    world.presence.open(PILOT, tab);
    world.presence.setVisibility(PILOT, tab, true);
    await minutes(1);
    world.presence.close(PILOT, tab);
    await vi.advanceTimersByTimeAsync(30_000);
    raise(PILOT, A);
    await vi.advanceTimersByTimeAsync(89_999);
    expect(world.pushed).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(world.pushed).toEqual([[PILOT, [A]]]);
  });

  it('never pushes a Décision once a tab became visible again before the 2 minutes', async () => {
    const { world, raise } = setUp();
    const tab = {};
    world.presence.open(PILOT, tab);
    world.presence.setVisibility(PILOT, tab, true);
    raise(PILOT, A);
    world.presence.setVisibility(PILOT, tab, false);
    await minutes(1);
    world.presence.setVisibility(PILOT, tab, true);
    await minutes(1);
    world.presence.setVisibility(PILOT, tab, false);
    await minutes(10);
    expect(world.pushed).toEqual([]);
    world.presence.setVisibility(PILOT, tab, true);
    raise(PILOT, B);
    world.presence.setVisibility(PILOT, tab, false);
    await minutes(2);
    expect(world.pushed).toEqual([[PILOT, [B]]]);
  });

  it('pushes together the Décisions raised while a tab was visible', async () => {
    const { world, raise } = setUp();
    const tab = {};
    world.presence.open(PILOT, tab);
    world.presence.setVisibility(PILOT, tab, true);
    raise(PILOT, A);
    raise(PILOT, B);
    world.presence.setVisibility(PILOT, tab, false);
    await minutes(2);
    expect(world.pushed).toEqual([[PILOT, [A, B]]]);
  });

  it('starts the 2 minutes again when a tab shows and hides again with a Décision raised meanwhile', async () => {
    const { world, raise } = setUp();
    const tab = {};
    world.presence.open(PILOT, tab);
    world.presence.setVisibility(PILOT, tab, true);
    raise(PILOT, A);
    world.presence.setVisibility(PILOT, tab, false);
    await minutes(1);
    world.presence.setVisibility(PILOT, tab, true);
    raise(PILOT, B);
    world.presence.setVisibility(PILOT, tab, false);
    await minutes(1);
    expect(world.pushed).toEqual([]);
    await minutes(1);
    expect(world.pushed).toEqual([[PILOT, [B]]]);
  });

  it('keeps each Pilote’s tabs to themselves', async () => {
    const { world, raise } = setUp();
    const tab = {};
    world.presence.open(OTHER, tab);
    world.presence.setVisibility(OTHER, tab, true);
    raise(PILOT, A);
    await minutes(0);
    expect(world.pushed).toEqual([[PILOT, [A]]]);
  });

  it('counts a tab that has not said its visibility yet as not visible', async () => {
    const { world, raise } = setUp();
    world.presence.open(PILOT, {});
    raise(PILOT, A);
    await minutes(0);
    expect(world.pushed).toEqual([[PILOT, [A]]]);
  });

  it('pushes after a restart what waited before it, once the tab back says it is hidden', async () => {
    const { world, raise, restart } = setUp();
    const tab = {};
    world.presence.open(PILOT, tab);
    world.presence.setVisibility(PILOT, tab, true);
    raise(PILOT, A);
    world.presence.setVisibility(PILOT, tab, false);
    await minutes(1);
    restart();
    const back = {};
    world.presence.open(PILOT, back);
    await minutes(0);
    expect(world.pushed).toEqual([]);
    world.presence.setVisibility(PILOT, back, false);
    await minutes(0);
    expect(world.pushed).toEqual([[PILOT, [A]]]);
  });

  it('never pushes after a restart what waited before it when the tab back is visible', async () => {
    const { world, raise, restart } = setUp();
    const tab = {};
    world.presence.open(PILOT, tab);
    world.presence.setVisibility(PILOT, tab, true);
    raise(PILOT, A);
    world.presence.setVisibility(PILOT, tab, false);
    restart();
    await minutes(1);
    const back = {};
    world.presence.open(PILOT, back);
    world.presence.setVisibility(PILOT, back, true);
    world.presence.setVisibility(PILOT, back, false);
    await minutes(10);
    expect(world.pushed).toEqual([]);
  });

  it('pushes with the next Décision what waited before a restart', async () => {
    const { world, raise, restart } = setUp();
    const tab = {};
    world.presence.open(PILOT, tab);
    world.presence.setVisibility(PILOT, tab, true);
    raise(PILOT, A);
    restart();
    raise(PILOT, B);
    await minutes(0);
    expect(world.pushed).toEqual([[PILOT, [A, B]]]);
  });

  it('tries again a push that reached no browser while the Pilote is away, 3 times at most', async () => {
    const { world, raise } = setUp(['retry', 'retry', 'retry', 'retry', 'retry']);
    raise(PILOT, A);
    await minutes(0);
    expect(world.tries).toHaveLength(1);
    await minutes(4);
    expect(world.tries).toHaveLength(1);
    await minutes(1);
    expect(world.tries).toHaveLength(2);
    await minutes(30);
    expect(world.tries).toHaveLength(1 + PUSH_RETRIES);
    expect(world.pushed).toEqual([]);
  });

  it('pushes on the try after a failure, then stops trying', async () => {
    const { world, raise } = setUp(['retry']);
    raise(PILOT, A);
    await minutes(5);
    expect(world.pushed).toEqual([[PILOT, [A]]]);
    await minutes(30);
    expect(world.tries).toHaveLength(2);
  });

  it('stops trying again once the Pilote is back', async () => {
    const { world, raise } = setUp(['retry', 'retry']);
    raise(PILOT, A);
    await minutes(1);
    const tab = {};
    world.presence.open(PILOT, tab);
    world.presence.setVisibility(PILOT, tab, true);
    await minutes(30);
    expect(world.tries).toHaveLength(1);
    expect(world.pushed).toEqual([]);
  });

  it('stops its timers with the module', async () => {
    const { world, raise } = setUp();
    const tab = {};
    world.presence.open(PILOT, tab);
    world.presence.setVisibility(PILOT, tab, true);
    raise(PILOT, A);
    world.presence.close(PILOT, tab);
    world.rule.onModuleDestroy();
    await minutes(5);
    expect(world.tries).toEqual([]);
  });
});
