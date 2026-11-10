import type { Bridge, CdActionDetail } from '@crewdeck/sdk';

/** The core's side of the in-page bridge: it publishes, and binds elements to topics. */
export interface InPageBridge extends Bridge {
  /** Sets a topic's data and calls its subscribers. */
  publish(topic: string, data: unknown): void;
  /** Keeps `el.data` equal to the topic's data; returns the unbind. */
  bind(el: Element, topic: string): () => void;
}

/**
 * The MVP's bridge (ADR 0006): the Skin runs in the top document, so data is
 * pushed to the elements' `data` property and actions go straight to the
 * dispatcher, as the root `cd-action` listener's do.
 */
export const createInPageBridge = ({ dispatch }: { dispatch: (detail: CdActionDetail) => void }): InPageBridge => {
  const latest = new Map<string, unknown>();
  const subscribers = new Map<string, Set<(data: unknown) => void>>();

  const subscribe = (topic: string, cb: (data: unknown) => void) => {
    const set = subscribers.get(topic) ?? new Set();
    subscribers.set(topic, set);
    set.add(cb);
    if (latest.has(topic)) cb(latest.get(topic));
    return () => {
      set.delete(cb);
    };
  };

  return {
    subscribe,
    act: (detail) => dispatch(detail),
    publish(topic, data) {
      latest.set(topic, data);
      for (const cb of [...(subscribers.get(topic) ?? [])]) cb(data);
    },
    bind: (el, topic) =>
      subscribe(topic, (data) => {
        (el as Element & { data: unknown }).data = data;
      }),
  };
};
