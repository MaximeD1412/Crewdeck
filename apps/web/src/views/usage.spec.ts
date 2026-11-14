import type { Runner, UsageAccount } from '@crewdeck/contracts';
import { COMPOSANTS } from '@crewdeck/sdk';
import { usageCard, usageCardCompact } from './usage.js';

/** Local instants, so that the cases hold in any time zone: Wednesday 11 November 2026, 15:12. */
const local = (day: number, hour: number, minute = 0) => new Date(2026, 10, day, hour, minute).toISOString();
const NOW = new Date(local(11, 15, 12));

const online = { state: 'online' } as Runner;
const offline = { state: 'offline' } as Runner;

const claude = (windows: Partial<UsageAccount['windows'][number]>[] = []): UsageAccount => ({
  id: '018f6b2a-7c3d-7e4f-9a1b-2c3d4e5f6a7c',
  engine: 'claude-code',
  kind: 'subscription',
  windows: windows.map((window) => ({
    id: 'week',
    usedPercent: 62,
    resetsAt: local(16, 8),
    holdsUntilReset: false,
    measuredAt: local(11, 14, 2),
    ...window,
  })),
  measuredAt: local(11, 14, 2),
});
const MOCKUP = claude([
  { id: 'five-hour', usedPercent: 100, resetsAt: local(11, 16, 40) },
  { id: 'week', usedPercent: 62, resetsAt: local(16, 8), exhaustsAt: local(12, 11), projectedPercent: 100 },
]);
const CODEX: UsageAccount = {
  id: '018f6b2a-7c3d-7e4f-9a1b-2c3d4e5f6a7d',
  engine: 'codex',
  kind: 'api-key',
  windows: [],
  monthSpend: { costUsdMicros: 23_418_720, costEurCents: 2160 },
  measuredAt: local(11, 13, 30),
};

const full = (...args: Parameters<typeof usageCard>) => {
  const data = usageCard(...args);
  return data && COMPOSANTS.UsageCard.data.parse(data);
};
const compact = (...args: Parameters<typeof usageCardCompact>) => {
  const data = usageCardCompact(...args);
  return data && COMPOSANTS.UsageCard.data.parse(data);
};
const sentences = (data: ReturnType<typeof full>) => data?.accounts.flatMap((account) => account.meters.map((meter) => meter.projection));

describe('usageCard', () => {
  it('gives the mockup’s card: Claude’s windows, the limit reached and the pace, Codex’s month spend', () => {
    expect(full({ usage: [MOCKUP, CODEX], runner: online, now: NOW })).toEqual({
      title: 'Usage des Comptes IA',
      accounts: [
        {
          title: 'Claude · abonnement',
          meters: [
            { label: 'Fenêtre de 5 h', value: 100, detail: '16:40', projection: 'Limite atteinte ; réinitialisation à 16:40.', tone: null },
            {
              label: 'Semaine',
              value: 62,
              detail: 'lundi',
              projection: 'Réinitialisation lundi ; au rythme actuel, la semaine tient jusqu’à jeudi.',
              mark: 100,
              tone: null,
            },
          ],
          monthSpend: null,
          note: null,
        },
        { title: 'Codex · clé API', meters: [], monthSpend: '21,60\u00a0€', note: null },
      ],
    });
  });

  it('says that a window holds until its reset, or only when it resets without a pace', () => {
    expect(sentences(full({ usage: [claude([{ holdsUntilReset: true }])], runner: online, now: NOW }))).toEqual([
      'Réinitialisation lundi ; au rythme actuel, la semaine tient jusqu’à la réinitialisation.',
    ]);
    expect(sentences(full({ usage: [claude([{}])], runner: online, now: NOW }))).toEqual(['Réinitialisation lundi.']);
  });

  it('gives the hour, not the day, of what happens today', () => {
    const view = full({ usage: [claude([{ resetsAt: local(11, 22), exhaustsAt: local(11, 18, 20) }])], runner: online, now: NOW });
    expect(view?.accounts[0]?.meters[0]).toMatchObject({
      detail: '22:00',
      projection: 'Réinitialisation à 22:00 ; au rythme actuel, la semaine tient jusqu’à 18:20.',
    });
  });

  it('with the Runner offline, says when it last measured, and only when each window resets', () => {
    const view = full({ usage: [MOCKUP, CODEX], runner: offline, now: NOW });
    expect(view?.accounts[0]?.note).toBe('Dernière mesure à 14:02, avant que le Runner se coupe.');
    expect(sentences(view)).toEqual(['Réinitialisation à 16:40.', 'Réinitialisation lundi.']);
    expect(view?.accounts[0]?.meters.map((meter) => meter.mark)).toEqual([undefined, undefined]);
    expect(view?.accounts[1]).toMatchObject({ monthSpend: '21,60\u00a0€', note: null });
  });

  it('says a month spend not converted yet as such', () => {
    const pending = { ...CODEX, monthSpend: { costUsdMicros: 1_000_000, costEurCents: null } };
    expect(full({ usage: [pending], runner: online, now: NOW })?.accounts[0]?.monthSpend).toBe('en attente du cours du jour');
  });

  it('is nothing without any usage', () => {
    expect(usageCard({ usage: [], runner: online, now: NOW })).toBeNull();
  });
});

describe('usageCardCompact', () => {
  it('gives « À toi »’s card: the windows named after their Compte IA, the reset of a limit reached, the pace sentence', () => {
    expect(compact({ usage: [MOCKUP, CODEX], runner: online, now: NOW })).toEqual({
      title: 'Comptes IA',
      accounts: [
        {
          title: null,
          meters: [
            { label: 'Claude · 5 h', value: 100, detail: '16:40', projection: null, tone: null },
            { label: 'Claude · semaine', value: 62, detail: null, projection: 'Au rythme actuel, la semaine de Claude tient jusqu’à jeudi.', tone: null },
          ],
          monthSpend: null,
          note: null,
        },
      ],
    });
  });

  it('with the Runner offline, no pace, and when it last measured', () => {
    const view = compact({ usage: [MOCKUP], runner: offline, now: NOW });
    expect(sentences(view)).toEqual([null, null]);
    expect(view?.accounts[0]?.note).toBe('Dernière mesure à 14:02, avant la coupure du Runner.');
  });

  it('is nothing without a window', () => {
    expect(usageCardCompact({ usage: [CODEX], runner: online, now: NOW })).toBeNull();
  });
});
