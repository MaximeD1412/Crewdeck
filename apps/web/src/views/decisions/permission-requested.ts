import { t } from '@crewdeck/sdk';
import { registerDecisionView, type DecisionView } from './registry.js';
import { openSessionPanel, requestEvent, roleOf } from './session-request.js';

/**
 * « Permission demandée » in « À toi » (SESSION-3): « <Rôle> · <Session> »,
 * « <outil> : <commande> » read from the Runner under it (« Ouvre la Session
 * pour lire la demande. » when it cannot be), « Ouvrir » the Session's panel.
 */
export const permissionRequestedView: DecisionView = {
  title: (decision, reads) => {
    const role = roleOf(decision);
    if (role === null) return decision.label;
    const title = t('decision.permissionRequested.title', { role: reads.roleName(role), title: decision.label });
    // A Session titled with its Rôle already (« Concevoir · Agenda partagé ») does not say it twice.
    return decision.label.startsWith(title.slice(0, title.length - decision.label.length)) ? decision.label : title;
  },
  context: (decision, reads) => {
    const event = requestEvent(decision, 'permission-request', reads);
    if (event === undefined) return null;
    return event === null
      ? t('decision.permissionRequested.unreadable')
      : t('decision.permissionRequested.context', { tool: event.tool, command: event.command });
  },
  actions: [{ id: 'open', label: 'decision.permissionRequested.open', primary: true, run: openSessionPanel }],
};

registerDecisionView('permission-requested', permissionRequestedView);
