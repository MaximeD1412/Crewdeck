import type { Decision, DecisionKind } from '@crewdeck/contracts';
import { t, type MessageKey } from '@crewdeck/sdk';

/** What a Décision's button may do: move to another page of the app. */
export interface DecisionActionContext {
  readonly navigate: (url: string) => void;
}

/** A button of a Décision in « À toi ». */
export interface DecisionAction {
  readonly id: string;
  /** Its label, a key of `t()`. */
  readonly label: MessageKey;
  readonly primary?: boolean;
  /** It runs on the Runner: disabled, with its reason, while the Runner is not « en ligne ». */
  readonly needsRunner?: boolean;
  run(decision: Decision, context: DecisionActionContext): void | Promise<void>;
}

/** How « À toi » shows a kind of Décision: its module's ticket registers it. */
export interface DecisionView {
  /** The row's title; the Décision's label by default. */
  readonly title?: (decision: Decision) => string;
  /** The line under the meta; none by default. */
  readonly context?: (decision: Decision) => string | null;
  readonly actions: readonly DecisionAction[];
}

/** « Ouvrir »: the Décision's page, its `link`. */
export const OPEN_ACTION: DecisionAction = {
  id: 'open',
  label: 'aToi.open',
  run: (decision, { navigate }) => navigate(decision.link),
};

/** The view of a kind no module has registered yet: its label as title, « Ouvrir ». */
export const DEFAULT_DECISION_VIEW: DecisionView = { actions: [OPEN_ACTION] };

export interface DecisionViews {
  /** Registers the view of `kind`; one per kind. */
  register(kind: DecisionKind, view: DecisionView): void;
  /** The view of `kind`, the default one when none is registered. */
  viewOf(kind: DecisionKind): DecisionView;
}

export const createDecisionViews = (): DecisionViews => {
  const views = new Map<DecisionKind, DecisionView>();
  return {
    register(kind, view) {
      if (views.has(kind)) throw new Error(`La vue de la Décision ${kind} est déjà enregistrée`);
      views.set(kind, view);
    },
    viewOf: (kind) => views.get(kind) ?? DEFAULT_DECISION_VIEW,
  };
};

/** The page's kind views: the module tickets register theirs on it. */
export const decisionViews = createDecisionViews();
export const registerDecisionView: DecisionViews['register'] = decisionViews.register;

/** The kind's label: « Ticket bloqué ». */
export const kindLabel = (kind: DecisionKind): string => t(`decision.kind.${kind}`);
