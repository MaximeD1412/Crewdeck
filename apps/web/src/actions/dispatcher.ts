import {
  CD_ACTION,
  COMPOSANTS,
  zCdActionDetail,
  type AnyComposant,
  type CdActionDetail,
  type ComposantAction,
  type ComposantParsedPayload,
} from '@crewdeck/sdk';

/** What the core runs for one action of one Composant. */
export interface ActionHandler<Payload> {
  run(payload: Payload): void | Promise<void>;
}

export interface Dispatcher {
  /** Registers the handler of `composant`'s `action`; one per action. */
  registerAction<C extends AnyComposant, A extends ComposantAction<C>>(
    composant: C,
    action: A,
    handler: ActionHandler<ComposantParsedPayload<C, A>>,
  ): void;
  /** Validates `detail` against its declaration and runs its handler; drops it with a warning otherwise. */
  dispatch(detail: unknown): void;
  /** Listens to every `cd-action` reaching `root`; returns the function that stops. */
  listen(root: EventTarget): () => void;
}

/**
 * The core's dispatcher (ADR 0006): a `cd-action` names its Composant and its
 * action; the payload is checked against the declaration's schema before the
 * registered handler runs. An unknown Composant or action, an invalid payload
 * or an action nobody handles runs nothing.
 */
export const createDispatcher = ({
  declarations = COMPOSANTS,
}: { declarations?: Readonly<Record<string, AnyComposant>> } = {}): Dispatcher => {
  const handlers = new Map<string, ActionHandler<unknown>>();
  const keyOf = (composant: string, action: string) => `${composant}.${action}`;

  const drop = (reason: string, detail: unknown) => console.warn(`cd-action dropped: ${reason}`, detail);

  const dispatch = (raw: unknown): void => {
    const parsed = zCdActionDetail.safeParse(raw);
    if (!parsed.success) return drop('malformed detail', raw);
    const detail: CdActionDetail = parsed.data;
    const declaration = Object.hasOwn(declarations, detail.composant) ? declarations[detail.composant] : undefined;
    if (!declaration) return drop(`unknown Composant ${detail.composant}`, detail);
    const schema = Object.hasOwn(declaration.actions, detail.action) ? declaration.actions[detail.action] : undefined;
    if (!schema) return drop(`unknown action ${detail.composant}.${detail.action}`, detail);
    const payload = schema.safeParse(detail.payload);
    if (!payload.success) return drop(`invalid payload for ${detail.composant}.${detail.action}`, payload.error.issues);
    const handler = handlers.get(keyOf(detail.composant, detail.action));
    if (!handler) return drop(`no handler for ${detail.composant}.${detail.action}`, detail);
    void handler.run(payload.data);
  };

  return {
    registerAction(composant, action, handler) {
      const key = keyOf(composant.name, action);
      if (handlers.has(key)) throw new Error(`Action ${key} déjà enregistrée`);
      handlers.set(key, handler as ActionHandler<unknown>);
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
