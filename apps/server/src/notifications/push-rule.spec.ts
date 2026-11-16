import type { Decision } from '@crewdeck/contracts';
import { TabPresence } from '../realtime/tab-presence.js';
import type { PushDelivery } from './push-delivery.js';
import { PUSH_AFTER_MS, PushRule } from './push-rule.js';

const PILOT = '019a6b2c-0000-7000-8000-000000000001';
const OTHER = '019a6b2c-0000-7000-8000-000000000002';

const decision = (id: string, change: Partial<Decision> = {}): Decision => ({
  id,
  kind: 'ticket-blocked',
  projectId: null,
  projectName: null,
  subjectType: 'ticket',
  subjectId: id,
  label: '#44 attend ta réponse',
  metaParts: [],
  tone: 'halt',
  link: '/tickets/44',
  params: {},
  state: 'open',
  outcome: null,
  createdAt: new Date().toISOString(),
  resolvedAt: null,
  ...change,
});

const A = decision('019a6b2c-0000-7000-8000-00000000000a');
const B = decision('019a6b2c-0000-7000-8000-00000000000b');

/** The rule against the real presence and the fake clock of Vitest; what it would push, recorded. */
const setUp = () => {
  const presence = new TabPresence();
  const pushed: { now: [string, string][]; waiting: [string, string[]][] } = { now: [], waiting: [] };
  const delivery = {
    now: (pilotId: string, created: Decision) => {
      pushed.now.push([pilotId, created.id]);
      return Promise.resolve();
    },
    waiting: (pilotId: string, ids: readonly string[]) => {
      pushed.waiting.push([pilotId, [...ids]]);
      return Promise.resolve();
    },
  } as unknown as PushDelivery;
  const rule = new PushRule(presence, delivery);
  rule.onModuleInit();
  return { presence, rule, pushed };
};

const minutes = (n: number) => vi.advanceTimersByTime(n * 60_000);

describe('PushRule', () => {
  beforeEach(() => vi.useFakeTimers({ now: new Date('2026-11-16T10:00:00Z') }));
  afterEach(() => vi.useRealTimers());

  it('waits 2 minutes', () => {
    expect(PUSH_AFTER_MS).toBe(120_000);
  });

  it('pushes a Décision at once when the Pilote has no tab open', () => {
    const { rule, pushed } = setUp();
    rule.created(PILOT, A);
    expect(pushed).toEqual({ now: [[PILOT, A.id]], waiting: [] });
  });

  it('pushes at once when the tabs open have all been hidden for 2 minutes', () => {
    const { presence, rule, pushed } = setUp();
    const tab = {};
    presence.open(PILOT, tab);
    presence.setVisibility(PILOT, tab, true);
    presence.setVisibility(PILOT, tab, false);
    minutes(2);
    rule.created(PILOT, A);
    expect(pushed.now).toEqual([[PILOT, A.id]]);
  });

  it('does not push while a tab is visible, then pushes what waits 2 minutes after the last visible tab hides', () => {
    const { presence, rule, pushed } = setUp();
    const [first, second] = [{}, {}];
    presence.open(PILOT, first);
    presence.setVisibility(PILOT, first, true);
    presence.open(PILOT, second);
    presence.setVisibility(PILOT, second, true);
    rule.created(PILOT, A);
    presence.setVisibility(PILOT, first, false);
    minutes(5);
    expect(pushed).toEqual({ now: [], waiting: [] });
    presence.close(PILOT, second);
    minutes(1);
    expect(pushed.waiting).toEqual([]);
    minutes(1);
    expect(pushed).toEqual({ now: [], waiting: [[PILOT, [A.id]]] });
    minutes(10);
    expect(pushed.waiting).toEqual([[PILOT, [A.id]]]);
  });

  it('waits out the 2 minutes of a tab hidden just before the Décision', () => {
    const { presence, rule, pushed } = setUp();
    const tab = {};
    presence.open(PILOT, tab);
    presence.setVisibility(PILOT, tab, true);
    minutes(1);
    presence.close(PILOT, tab);
    vi.advanceTimersByTime(30_000);
    rule.created(PILOT, A);
    expect(pushed.now).toEqual([]);
    vi.advanceTimersByTime(89_999);
    expect(pushed.waiting).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(pushed.waiting).toEqual([[PILOT, [A.id]]]);
  });

  it('never pushes a Décision once a tab became visible again before the 2 minutes', () => {
    const { presence, rule, pushed } = setUp();
    const tab = {};
    presence.open(PILOT, tab);
    presence.setVisibility(PILOT, tab, true);
    rule.created(PILOT, A);
    presence.setVisibility(PILOT, tab, false);
    minutes(1);
    presence.setVisibility(PILOT, tab, true);
    minutes(1);
    presence.setVisibility(PILOT, tab, false);
    minutes(10);
    expect(pushed).toEqual({ now: [], waiting: [] });
    presence.setVisibility(PILOT, tab, true);
    rule.created(PILOT, B);
    presence.setVisibility(PILOT, tab, false);
    minutes(2);
    expect(pushed).toEqual({ now: [], waiting: [[PILOT, [B.id]]] });
  });

  it('pushes together the Décisions raised while a tab was visible', () => {
    const { presence, rule, pushed } = setUp();
    const tab = {};
    presence.open(PILOT, tab);
    presence.setVisibility(PILOT, tab, true);
    rule.created(PILOT, A);
    rule.created(PILOT, B);
    presence.setVisibility(PILOT, tab, false);
    minutes(2);
    expect(pushed).toEqual({ now: [], waiting: [[PILOT, [A.id, B.id]]] });
  });

  it('starts the 2 minutes again when a tab shows and hides again with a Décision raised meanwhile', () => {
    const { presence, rule, pushed } = setUp();
    const tab = {};
    presence.open(PILOT, tab);
    presence.setVisibility(PILOT, tab, true);
    rule.created(PILOT, A);
    presence.setVisibility(PILOT, tab, false);
    minutes(1);
    presence.setVisibility(PILOT, tab, true);
    rule.created(PILOT, B);
    presence.setVisibility(PILOT, tab, false);
    minutes(1);
    expect(pushed.waiting).toEqual([]);
    minutes(1);
    expect(pushed).toEqual({ now: [], waiting: [[PILOT, [B.id]]] });
  });

  it('keeps each Pilote’s tabs to themselves', () => {
    const { presence, rule, pushed } = setUp();
    const tab = {};
    presence.open(OTHER, tab);
    presence.setVisibility(OTHER, tab, true);
    rule.created(PILOT, A);
    expect(pushed.now).toEqual([[PILOT, A.id]]);
  });

  it('counts a tab that has not said its visibility yet as not visible', () => {
    const { presence, rule, pushed } = setUp();
    presence.open(PILOT, {});
    rule.created(PILOT, A);
    expect(pushed.now).toEqual([[PILOT, A.id]]);
  });

  it('stops its timers with the module', () => {
    const { presence, rule, pushed } = setUp();
    const tab = {};
    presence.open(PILOT, tab);
    presence.setVisibility(PILOT, tab, true);
    rule.created(PILOT, A);
    presence.close(PILOT, tab);
    rule.onModuleDestroy();
    minutes(5);
    expect(pushed.waiting).toEqual([]);
  });
});
