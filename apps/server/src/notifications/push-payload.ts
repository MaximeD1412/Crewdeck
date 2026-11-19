import type { Decision, DecisionKind, PushPayload } from '@crewdeck/contracts';

/**
 * The title of each kind, as the page's « À toi » says it
 * (`decision.kind.*` of `@crewdeck/sdk`, which the server does not import).
 */
export const KIND_LABELS: Record<DecisionKind, string> = {
  'agent-question': 'Question de l’agent',
  'ai-account-disconnected': 'Compte IA déconnecté',
  'contract-incomplete': 'Contrat incomplet',
  'document-review': 'Conception à relire',
  'ideas-to-triage': 'Idées à trier',
  'inventory-review': 'Inventaire à approuver',
  'limit-reached': 'Limite atteinte',
  'loop-back.exhausted': 'Maximum de Retours atteint',
  'permission-requested': 'Permission demandée',
  'runner-offline': 'Runner hors ligne',
  'step-failed': 'Étape échouée',
  'ticket-blocked': 'Ticket bloqué',
  'ticket-draft': 'Ticket à valider',
  'ticket-interrupted': 'Ticket interrompu',
  'visual-review': 'Revue visuelle',
};

/**
 * What a push says (ADR 0003: the kind, the readable label and a link, no
 * other text): one Décision, « <kind> · <label> » opening its link, the Idées
 * « Idées à trier » only; several, « <n> Décisions t’attendent » opening « À
 * toi ». Tagged with the Décision's id, or `decisions` for several: a newer
 * push replaces the notification it updates.
 */
export const pushPayloadOf = (decisions: readonly Pick<Decision, 'id' | 'kind' | 'label' | 'link'>[]): PushPayload => {
  const [only] = decisions;
  if (decisions.length !== 1 || !only) return { title: `${decisions.length} Décisions t’attendent`, url: '/a-toi', tag: 'decisions' };
  const title = only.kind === 'ideas-to-triage' ? KIND_LABELS[only.kind] : `${KIND_LABELS[only.kind]} · ${only.label}`;
  return { title, url: only.link, tag: only.id };
};
