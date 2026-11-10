import { fr, type MessageKey } from './fr.js';

export type MessageParams = Readonly<Record<string, string | number>>;

/** Vite replaces `import.meta.env.PROD` in the page's build; outside Vite it is absent. */
const isProduction = (): boolean => import.meta.env?.PROD === true;

/**
 * A `t()` over `catalogue`: `{name}` placeholders are replaced by `params`; an
 * unknown key throws outside production and comes back as is in production.
 */
export const createTranslator =
  <Key extends string>(catalogue: Readonly<Record<Key, string>>) =>
  (key: Key, params?: MessageParams): string => {
    const message: string | undefined = Object.hasOwn(catalogue, key) ? catalogue[key] : undefined;
    if (message === undefined) {
      if (isProduction()) return key;
      throw new Error(`Clé de traduction inconnue : ${key}`);
    }
    if (!params) return message;
    return message.replace(/\{(\w+)\}/g, (placeholder, name: string) =>
      Object.hasOwn(params, name) ? String(params[name]) : placeholder,
    );
  };

/** The UI copy: every label of a Composant comes from here or from its `data`. */
export const t: (key: MessageKey, params?: MessageParams) => string = createTranslator(fr);
