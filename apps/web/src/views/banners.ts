import type { Decision, Runner } from '@crewdeck/contracts';
import { formatHour, t, type Banner, type Button, type CodeBlock, type ComposantData } from '@crewdeck/sdk';
import type { StoreState } from '../store/store.js';
import { offlineSince, projectsCount, START_COMMAND, RUNNER_PAGE, waitingItemsText, waitingProjectsOf } from './decisions/runner-offline.js';

export type BannerData = ComposantData<typeof Banner>;

/** What a Banner holds in its `actions` Emplacement: a button leading to a page of the app, or a command to copy. */
export type BannerAction =
  | { readonly kind: 'button'; readonly data: ComposantData<typeof Button>; readonly href: string }
  | { readonly kind: 'code'; readonly data: ComposantData<typeof CodeBlock> };

/** One Banner of the Cadre's `banner` Emplacement: its data, the text of its default Emplacement, its action. */
export interface BannerView {
  /** Which banner it is, the same element kept from one state to the next. */
  readonly key: 'resync' | 'runner-offline' | 'error';
  readonly data: BannerData;
  readonly text: string | null;
  readonly action?: BannerAction;
}

/** What the Banners read: the store's connection, and for « Runner hors ligne » the page, the Runner and the open Décisions. */
export interface BannersState extends Pick<StoreState, 'connection' | 'lostAt'> {
  /** The page's path (`/a-toi`); none before the first route. */
  readonly path?: string | null;
  readonly runner?: Pick<Runner, 'state'> | null;
  readonly decisions?: Iterable<Decision>;
}

const RUNNER_OFFLINE: BannerData = { tone: 'halt', title: t('runnerOffline.title'), icon: 'server' };

const names = new Intl.ListFormat('fr', { type: 'conjunction' });

const runnerOfflineDecision = (decisions: Iterable<Decision>): Decision | undefined => {
  for (const decision of decisions) if (decision.kind === 'runner-offline') return decision;
  return undefined;
};

/**
 * « Runner hors ligne » (ATOI-3): on `/a-toi` while its Décision is open,
 * since when and what waits in each Projet, « Voir le Runner »; on `/runner`
 * while the linked Runner is offline, « Rien ne tourne » with the Projets
 * that wait (or none), and the command that relaunches it.
 */
const runnerOfflineBanner = ({ path, runner, decisions = [] }: BannersState): BannerView | null => {
  const decision = runnerOfflineDecision(decisions);
  if (path === '/a-toi' && decision) {
    const projects = waitingProjectsOf(decision);
    return {
      key: 'runner-offline',
      data: RUNNER_OFFLINE,
      text: t('runnerOffline.aToi.body', {
        time: formatHour(offlineSince(decision)),
        count: projectsCount(projects.length),
        projects: projects.map((project) => t('runnerOffline.aToi.project', { name: project.name, items: waitingItemsText(project) })).join(', '),
      }),
      action: {
        kind: 'button',
        data: { label: t('decision.runnerOffline.openRunner'), variant: 'secondary', size: 'sm', icon: 'server' },
        href: RUNNER_PAGE,
      },
    };
  }
  if (path === RUNNER_PAGE && runner && runner.state !== 'online') {
    const projects = decision ? waitingProjectsOf(decision) : [];
    return {
      key: 'runner-offline',
      data: RUNNER_OFFLINE,
      text:
        projects.length > 0
          ? t('runnerOffline.runner.body', { projects: names.format(projects.map((project) => project.name)) })
          : t('runnerOffline.runner.empty'),
      action: { kind: 'code', data: { code: START_COMMAND } },
    };
  }
  return null;
};

/**
 * The core's Banners above the page (pure): the Resynchronisation's while the
 * page lost the state and is not `live` again (ADR 0007), the time of the
 * loss in its text; « Runner hors ligne » on `/a-toi` and `/runner`; then the
 * API error no caller handled, its `message` as is (ADR 0008). The first
 * boot, before any loss, shows none.
 */
export const bannersView = (state: BannersState, error: string | null): readonly BannerView[] => {
  const banners: BannerView[] = [];
  if (state.connection !== 'live' && state.lostAt) {
    banners.push({
      key: 'resync',
      data: { tone: 'caution', title: t('resync.title'), icon: 'refresh' },
      text: t('resync.body', { time: formatHour(state.lostAt) }),
    });
  }
  const offline = runnerOfflineBanner(state);
  if (offline) banners.push(offline);
  if (error !== null) banners.push({ key: 'error', data: { tone: 'halt', title: error, icon: 'alert' }, text: null });
  return banners;
};
