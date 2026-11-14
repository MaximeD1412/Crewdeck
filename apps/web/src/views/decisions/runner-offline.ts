import { parseWaitingProjects, type Decision, type WaitingItem, type WaitingItemKind, type WaitingProject } from '@crewdeck/contracts';
import { formatHour, t, type MessageKey } from '@crewdeck/sdk';
import { registerDecisionView, type DecisionView } from './registry.js';

/** The page that says what to do: relaunch the Runner. */
export const RUNNER_PAGE = '/runner';

/** The command the Pilote runs on their machine to start the Runner's service again (ADR 0004, `runner-hors-ligne`). */
export const START_COMMAND = 'crewdeck-runner start';

type Plural = 'one' | 'other';

/** Each kind's phrase: of one Ticket or Étape by its number (« #44 en cours »), else counted (« 2 Tickets prêts »). */
const ITEM_PHRASES: Readonly<Record<WaitingItemKind, { readonly numbered: MessageKey | null; readonly counted: string }>> = {
  'ticket-in-progress': { numbered: 'runnerOffline.item.ticketInProgress', counted: 'runnerOffline.item.ticketsInProgress' },
  'tickets-ready': { numbered: 'runnerOffline.item.ticketReady', counted: 'runnerOffline.item.ticketsReady' },
  'ticket-interrupted': { numbered: 'runnerOffline.item.ticketInterrupted', counted: 'runnerOffline.item.ticketsInterrupted' },
  'ideas-waiting': { numbered: null, counted: 'runnerOffline.item.ideasWaiting' },
  'step-queued': { numbered: 'runnerOffline.item.stepQueued', counted: 'runnerOffline.item.stepsQueued' },
};

const plural = (count: number): Plural => (count === 1 ? 'one' : 'other');

/** One thing that waits: « #44 en cours », « 2 Tickets prêts », « 1 Idée en attente ». */
export const waitingItemText = ({ kind, number, count }: WaitingItem): string => {
  const phrase = ITEM_PHRASES[kind];
  if (number !== undefined && phrase.numbered) return t(phrase.numbered, { number });
  const n = count ?? 1;
  return t(`${phrase.counted}.${plural(n)}` as MessageKey, { count: n });
};

/** What waits in one Projet: « #53 en cours, 2 Tickets prêts ». */
export const waitingItemsText = (project: WaitingProject): string => project.items.map(waitingItemText).join(', ');

/** « 3 Projets », « 1 Projet ». */
export const projectsCount = (count: number): string => t(`runnerOffline.projects.${plural(count)}`, { count });

/** The Projets whose work waits, as the server wrote them; none for a malformed `params.projects`. */
export const waitingProjectsOf = (decision: Pick<Decision, 'params'>): WaitingProject[] => parseWaitingProjects(decision.params['projects']);

/** Since when the Runner is silent: its last heartbeat (`params.since`), the Décision's creation without it. */
export const offlineSince = (decision: Pick<Decision, 'params' | 'createdAt'>): string => {
  const since = decision.params['since'];
  return typeof since === 'string' && !Number.isNaN(Date.parse(since)) ? since : decision.createdAt;
};

/**
 * « Runner hors ligne » in « À toi » (ATOI-3): « 3 Projets · depuis 14:02 »,
 * what waits in each Projet (« Crewdeck : #44 en cours · Personal OS : #53 en
 * cours, 2 Tickets prêts »), and « Voir le Runner ».
 */
export const runnerOfflineView: DecisionView = {
  meta: (decision) => t('decision.runnerOffline.meta', { projects: projectsCount(waitingProjectsOf(decision).length), time: formatHour(offlineSince(decision)) }),
  context: (decision) => {
    const projects = waitingProjectsOf(decision);
    if (projects.length === 0) return null;
    return projects.map((project) => t('decision.runnerOffline.project', { name: project.name, items: waitingItemsText(project) })).join(' · ');
  },
  actions: [
    {
      id: 'open-runner',
      label: 'decision.runnerOffline.openRunner',
      primary: true,
      run: (_decision, { navigate }) => navigate(RUNNER_PAGE),
    },
  ],
};

registerDecisionView('runner-offline', runnerOfflineView);
