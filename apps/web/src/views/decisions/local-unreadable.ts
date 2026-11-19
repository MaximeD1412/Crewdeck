import { localSealedOfParam } from '@crewdeck/contracts';
import { t } from '@crewdeck/sdk';
import { registerDecisionView, type DecisionAction, type DecisionView, OPEN_ACTION } from './registry.js';

/** « Ouvrir » its Projet, the one thing to do once the file is fixed by hand. */
const OPEN_PROJECT: DecisionAction = { ...OPEN_ACTION, primary: true };

/**
 * « Fichier de Ticket illisible » of a Local Projet (SOURCE-3): its reason in
 * the meta, as the server wrote it; the file's path, sealed by the Runner
 * under `unreadable:<key>:path` (its key the end of the Décision's subject),
 * opened by the page for the line under it.
 */
export const localUnreadableView: DecisionView = {
  context: (decision, reads) => {
    const sealed = localSealedOfParam(decision.params['pathSealed']);
    const prefix = `${decision.projectId ?? ''}:`;
    if (sealed === null || decision.projectId === null || !decision.subjectId.startsWith(prefix)) return null;
    const key = decision.subjectId.slice(prefix.length);
    return t('decision.localUnreadable.context', { path: reads.localText(decision.projectId, sealed, `unreadable:${key}:path`) });
  },
  actions: [OPEN_PROJECT],
};

registerDecisionView('ticket.local-unreadable', localUnreadableView);
