/**
 * The French message of every error code the server renders (ADR 0008): the
 * page shows `message` as is. A test checks every code here matches
 * `<module>.<case>` and every code thrown in `src/` has its entry.
 */
export const MESSAGES = {
  'auth.github-expired': 'Ta connexion GitHub a expiré, reconnecte-toi.',
  'auth.origin': 'Cette requête ne vient pas de la page de Crewdeck.',
  'auth.required': 'Connecte-toi pour continuer.',
  'fake-github.not-found': 'Ce fichier n’existe pas sur le faux GitHub.',
  'github.bad-signature': 'La signature de ce webhook GitHub n’est pas valide.',
  'github.branch-protected': 'Une protection de branche refuse cette écriture.',
  'github.head-moved': 'La PR a changé depuis la dernière vérification.',
  'github.process-json-invalid': 'Le fichier .process.json du dépôt n’est pas du JSON valide.',
  'github.user-token-refused': 'GitHub a refusé l’autorisation, reconnecte-toi.',
  'github.unavailable': 'GitHub ne répond pas, réessaie dans un instant.',
  'http.bad-request': 'La requête n’est pas valide.',
  'http.not-found': 'Cette adresse n’existe pas.',
  'realtime.stale': 'L’état a changé depuis ton dernier affichage : vérifie avant de recommencer.',
  'runner.not-linked': 'Aucun Runner n’est relié à ton compte.',
  'runner.offline': 'Le Runner est hors ligne.',
  'server.internal': 'Une erreur inattendue est survenue.',
  'testing.unknown-scenario': 'Scénario de test inconnu.',
  'validation.invalid': 'Certaines valeurs ne sont pas valides.',
} as const satisfies Record<string, string>;

export type MessageCode = keyof typeof MESSAGES;
