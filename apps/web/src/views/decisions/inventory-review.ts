import { t } from '@crewdeck/sdk';
import { type DecisionAction, type DecisionView, OPEN_ACTION, registerDecisionView } from './registry.js';

/** « Relire » the Inventaire, on its Projet's page (PROJET-5 reads, approves or sends it back there). */
const READ: DecisionAction = { ...OPEN_ACTION, id: 'read', label: 'decision.inventoryReview.read', primary: true };

/**
 * « Inventaire à approuver » in « À toi » (PROJET-4, US-3): the Projet's
 * Inventaire drafted from its code, to approve before its Process; « Relire »
 * opens its Projet.
 */
export const inventoryReviewView: DecisionView = {
  context: () => t('decision.inventoryReview.context'),
  actions: [READ],
};

registerDecisionView('inventory-review', inventoryReviewView);
