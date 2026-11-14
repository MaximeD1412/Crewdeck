import type { Runner, UsageAccount, UsageWindow } from '@crewdeck/contracts';
import { formatEuros, formatHour, formatWeekday, sameDay, t, type ComposantData, type UsageCard } from '@crewdeck/sdk';

export type UsageCardData = ComposantData<typeof UsageCard>;
type Meter = UsageCardData['accounts'][number]['meters'][number];

export interface UsageState {
  /** The `usage` slice. */
  readonly usage: Iterable<UsageAccount>;
  /** The `runner` slice: offline (or none), the measures are the last it sent. */
  readonly runner: Runner | null;
  /** The instant « today » is read from: now by default. */
  readonly now?: Date;
}

const ORDER: readonly UsageWindow['id'][] = ['five-hour', 'week'];
const byWindow = (a: UsageWindow, b: UsageWindow): number => ORDER.indexOf(a.id) - ORDER.indexOf(b.id);

/** « 16:40 » for an instant of today (or any of a 5-hour window), « lundi » for another day. */
const shortWhen = (instant: string, now: Date, hourly = false): string =>
  hourly || sameDay(instant, now) ? formatHour(instant) : formatWeekday(instant);
/** « à 16:40 » or « lundi », after « Réinitialisation ». */
const resetWhen = (window: UsageWindow, now: Date): string =>
  window.id === 'five-hour' || sameDay(window.resetsAt, now) ? t('usage.when.hour', { time: formatHour(window.resetsAt) }) : formatWeekday(window.resetsAt);

const reached = (window: UsageWindow): boolean => window.usedPercent >= 100;
const engineName = (account: UsageAccount): string => t(`usage.engine.${account.engine}`);

/** The sentence under a window of `/runner`: the limit reached, where the pace leads, or only when it resets (offline, or no pace). */
const sentence = (window: UsageWindow, live: boolean, now: Date): string => {
  const when = resetWhen(window, now);
  if (!live) return t('usage.resets', { when });
  if (reached(window)) return t('usage.reached', { when });
  const noun = t(`usage.windowNoun.${window.id}`);
  if (window.exhaustsAt) return t('usage.exhausts', { when, window: noun, until: shortWhen(window.exhaustsAt, now) });
  if (window.holdsUntilReset) return t('usage.holds', { when, window: noun });
  return t('usage.resets', { when });
};

/** « À toi »'s sentence: only where the pace leads, while the Runner runs and the window is not used up. */
const compactSentence = (window: UsageWindow, account: UsageAccount, live: boolean, now: Date): string | null => {
  if (!live || reached(window)) return null;
  const names = { window: t(`usage.windowNoun.${window.id}`), engine: engineName(account) };
  if (window.exhaustsAt) return t('usage.compactExhausts', { ...names, until: shortWhen(window.exhaustsAt, now) });
  if (window.holdsUntilReset) return t('usage.compactHolds', names);
  return null;
};

const detail = (window: UsageWindow, now: Date): string => shortWhen(window.resetsAt, now, window.id === 'five-hour');

const latest = (accounts: readonly UsageAccount[]): string =>
  accounts.map((account) => account.measuredAt).reduce((a, b) => (a > b ? a : b));

/** An API key's month spend; past the month's end, the new month's, nothing until the next spend. */
const monthSpend = ({ monthSpend: spend }: UsageAccount, now: Date): string | null => {
  if (spend === undefined) return null;
  if (new Date(spend.endsAt) <= now) return formatEuros(0);
  return spend.costEurCents === null ? t('usage.monthSpendPending') : formatEuros(spend.costEurCents);
};

/** `account` without its windows that have reset by `now`: their measure is the old window's. */
const current = (account: UsageAccount, now: Date): UsageAccount => ({
  ...account,
  windows: account.windows.filter((window) => new Date(window.resetsAt) > now),
});

/**
 * When the usage changes with time alone (pure): the next reset of a window
 * or end of a month spend's month after `now`, `null` without one. The page
 * renders the cards again then, a new measure or not.
 */
export const usageChangesAt = (usage: Iterable<UsageAccount>, now: Date): Date | null => {
  const instants = [...usage]
    .flatMap((account) => [...account.windows.map((window) => window.resetsAt), ...(account.monthSpend ? [account.monthSpend.endsAt] : [])])
    .map((instant) => new Date(instant))
    .filter((instant) => instant > now);
  return instants.length === 0 ? null : new Date(Math.min(...instants.map((instant) => instant.getTime())));
};

/**
 * `/runner`'s « Usage des Comptes IA » (pure, US-55): each Compte IA that
 * has a usage, titled by its Moteur and its kind, a meter per window with
 * when it resets and where the pace leads (its sentence, and its tick on
 * the bar), an API key's month spend. With the Runner offline, the measures
 * are the last it sent: their time said, no pace. A window that has reset
 * is left out, and a Compte IA left with nothing; nothing without any usage.
 */
export const usageCard = ({ usage, runner, now = new Date() }: UsageState): UsageCardData | null => {
  const accounts = [...usage].map((account) => current(account, now)).filter((account) => account.windows.length > 0 || account.monthSpend);
  if (accounts.length === 0) return null;
  const live = runner?.state === 'online';
  return {
    title: t('usage.title'),
    accounts: accounts.map((account) => ({
      title: t('usage.account', { engine: engineName(account), kind: t(`usage.kind.${account.kind}`) }),
      meters: [...account.windows].sort(byWindow).map(
        (window): Meter => ({
          label: t(`usage.window.${window.id}`),
          value: window.usedPercent,
          detail: detail(window, now),
          projection: sentence(window, live, now),
          ...(live && window.projectedPercent !== undefined ? { mark: window.projectedPercent } : {}),
          tone: null,
        }),
      ),
      monthSpend: monthSpend(account, now),
      note: !live && account.windows.length > 0 ? t('usage.lastMeasure', { time: formatHour(account.measuredAt) }) : null,
    })),
  };
};

/**
 * « À toi »'s « Comptes IA » (pure): every window of every Compte IA in one
 * list, named after its Moteur (« Claude · 5 h »), the reset of a limit
 * reached, the pace's sentence; offline, when the Runner last measured.
 * Nothing without a window that has not reset.
 */
export const usageCardCompact = ({ usage, runner, now = new Date() }: UsageState): UsageCardData | null => {
  const accounts = [...usage].map((account) => current(account, now)).filter((account) => account.windows.length > 0);
  if (accounts.length === 0) return null;
  const live = runner?.state === 'online';
  return {
    title: t('usage.compactTitle'),
    accounts: [
      {
        title: null,
        meters: accounts.flatMap((account) =>
          [...account.windows].sort(byWindow).map(
            (window): Meter => ({
              label: t(`usage.compactWindow.${window.id}`, { engine: engineName(account) }),
              value: window.usedPercent,
              detail: reached(window) ? detail(window, now) : null,
              projection: compactSentence(window, account, live, now),
              tone: null,
            }),
          ),
        ),
        monthSpend: null,
        note: live ? null : t('usage.lastMeasureCompact', { time: formatHour(latest(accounts)) }),
      },
    ],
  };
};
