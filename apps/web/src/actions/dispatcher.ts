import {
  actionSchema,
  CD_ACTION,
  COMPOSANTS,
  sensitiveActionOf,
  zCdActionDetail,
  type AnyComposant,
  type CdActionDetail,
  type ComposantAction,
  type ComposantParsedPayload,
  type SensitiveActionDeclaration,
} from '@crewdeck/sdk';
import { announcer } from '../announcer.js';
import { confirmSensitiveAction, type ConfirmOptions } from '../dialogs/confirm.js';
import { sensitiveBlockedReason } from '../store/sensitive.js';
import { store } from '../store/index.js';
import type { StoreState } from '../store/store.js';

/** What the core runs for one free action of one Composant. */
export interface ActionHandler<Payload> {
  run(payload: Payload): void | Promise<void>;
}

/** What an Action sensible asks the Pilote to confirm, from its payload and the state they see. */
export type SensitiveConfirmation<Payload> = (payload: Payload, state: StoreState) => Omit<ConfirmOptions, 'action'>;

/**
 * What the core runs for one Action sensible: once confirmed, with the `seq`
 * the Pilote saw when the dialog opened, for the server's freshness check.
 */
export interface SensitiveActionHandler<Payload> {
  confirmation: SensitiveConfirmation<Payload>;
  run(payload: Payload, context: { readonly seq: bigint }): void | Promise<void>;
}

/** The handler an action asks for: a confirmation for an Action sensible. */
export type HandlerOf<C extends AnyComposant, A extends ComposantAction<C>> =
  C['actions'][A] extends SensitiveActionDeclaration
    ? SensitiveActionHandler<ComposantParsedPayload<C, A>>
    : ActionHandler<ComposantParsedPayload<C, A>>;

export interface Dispatcher {
  /** Registers the handler of `composant`'s `action`; one per action, a confirmation for an Action sensible. */
  registerAction<C extends AnyComposant, A extends ComposantAction<C>>(
    composant: C,
    action: A,
    handler: HandlerOf<C, A>,
  ): void;
  /** Validates `detail` against its declaration and runs its handler; drops it with a warning otherwise. */
  dispatch(detail: unknown): void;
  /** Listens to every `cd-action` reaching `root`; returns the function that stops. */
  listen(root: EventTarget): () => void;
}

export interface DispatcherOptions {
  readonly declarations?: Readonly<Record<string, AnyComposant>>;
  /** The state an Action sensible is checked against, and its `seq` captured from. */
  readonly state?: () => StoreState;
  /** Opens the core's confirmation; resolves true once the Pilote confirms. */
  readonly confirm?: (options: ConfirmOptions) => Promise<boolean>;
  /** Says why an Action sensible was refused, through the Cadre's aria-live region. */
  readonly announce?: (text: string) => void;
}

type AnyHandler = {
  run(payload: unknown, context?: { readonly seq: bigint }): void | Promise<void>;
  confirmation?: SensitiveConfirmation<unknown>;
};

/**
 * The core's dispatcher (ADR 0006): a `cd-action` names its Composant and its
 * action; the payload is checked against the declaration's schema before the
 * registered handler runs. An unknown Composant or action, an invalid payload
 * or an action nobody handles runs nothing.
 *
 * An Action sensible runs only once the Pilote confirmed it in the core's
 * `crewdeck-confirm`, with the `seq` captured when the dialog opened; during
 * the Resynchronisation it opens nothing and its reason is announced.
 */
export const createDispatcher = ({
  declarations = COMPOSANTS,
  state = () => store.getState(),
  confirm = confirmSensitiveAction,
  announce = (text) => announcer.announce(text),
}: DispatcherOptions = {}): Dispatcher => {
  const handlers = new Map<string, AnyHandler>();
  const keyOf = (composant: string, action: string) => `${composant}.${action}`;
  /** One confirmation at a time: another Action sensible meanwhile runs nothing. */
  let confirming = false;

  const drop = (reason: string, detail: unknown) => console.warn(`cd-action dropped: ${reason}`, detail);

  const runSensitive = async (action: ConfirmOptions['action'], handler: AnyHandler, payload: unknown) => {
    const blocked = sensitiveBlockedReason(state());
    if (blocked !== null) return announce(blocked);
    if (confirming || !handler.confirmation) return;
    const seen = state();
    const seq = seen.seq ?? 0n;
    confirming = true;
    try {
      const confirmed = await confirm({ action, ...handler.confirmation(payload, seen) });
      if (!confirmed) return;
      const late = sensitiveBlockedReason(state());
      if (late !== null) return announce(late);
      await handler.run(payload, { seq });
    } finally {
      confirming = false;
    }
  };

  const dispatch = (raw: unknown): void => {
    const parsed = zCdActionDetail.safeParse(raw);
    if (!parsed.success) return drop('malformed detail', raw);
    const detail: CdActionDetail = parsed.data;
    const declaration = Object.hasOwn(declarations, detail.composant) ? declarations[detail.composant] : undefined;
    if (!declaration) return drop(`unknown Composant ${detail.composant}`, detail);
    const declared = Object.hasOwn(declaration.actions, detail.action) ? declaration.actions[detail.action] : undefined;
    if (!declared) return drop(`unknown action ${detail.composant}.${detail.action}`, detail);
    const payload = actionSchema(declared).safeParse(detail.payload);
    if (!payload.success) return drop(`invalid payload for ${detail.composant}.${detail.action}`, payload.error.issues);
    const handler = handlers.get(keyOf(detail.composant, detail.action));
    if (!handler) return drop(`no handler for ${detail.composant}.${detail.action}`, detail);
    const sensitive = sensitiveActionOf(declared);
    if (sensitive === null) {
      void handler.run(payload.data);
      return;
    }
    void runSensitive(sensitive, handler, payload.data);
  };

  return {
    registerAction(composant, action, handler) {
      const key = keyOf(composant.name, action);
      if (handlers.has(key)) throw new Error(`Action ${key} déjà enregistrée`);
      const declared = composant.actions[action];
      const given = handler as AnyHandler;
      if (declared !== undefined && sensitiveActionOf(declared) !== null && typeof given.confirmation !== 'function') {
        throw new Error(`Action sensible ${key} enregistrée sans confirmation`);
      }
      handlers.set(key, given);
    },
    dispatch,
    listen(root) {
      const listener = (event: Event) => dispatch((event as CustomEvent).detail);
      root.addEventListener(CD_ACTION, listener);
      return () => root.removeEventListener(CD_ACTION, listener);
    },
  };
};

/** The page's dispatcher: page tickets register their actions on it. */
export const dispatcher = createDispatcher();
export const registerAction: Dispatcher['registerAction'] = dispatcher.registerAction;
