/**
 * The French message of every error code the server renders (ADR 0008): the
 * page shows `message` as is. A test checks every code here matches
 * `<module>.<case>` and every code thrown in `src/` has its entry.
 */
export const MESSAGES = {
  'http.bad-request': 'La requête n’est pas valide.',
  'http.not-found': 'Cette adresse n’existe pas.',
  'server.internal': 'Une erreur inattendue est survenue.',
  'testing.unknown-scenario': 'Scénario de test inconnu.',
  'validation.invalid': 'Certaines valeurs ne sont pas valides.',
} as const satisfies Record<string, string>;

export type MessageCode = keyof typeof MESSAGES;
