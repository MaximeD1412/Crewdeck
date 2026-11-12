/**
 * The French message of every error code the server renders (ADR 0008): the
 * page shows `message` as is. A test checks every code here matches
 * `<module>.<case>` and every code thrown in `src/` has its entry.
 */
export const MESSAGES = {
  'auth.github-expired': 'Ta connexion GitHub a expiré, reconnecte-toi.',
  'auth.origin': 'Cette requête ne vient pas de la page de Crewdeck.',
  'auth.required': 'Connecte-toi pour continuer.',
  'devices.approval-invalid': 'Cette approbation ne correspond pas à la clé actuelle du coffre : recommence depuis l’Appareil de confiance.',
  'devices.code-unknown': 'Ce code est inconnu ou a expiré : affiche un nouveau code sur le nouvel Appareil.',
  'devices.not-found': 'Cet Appareil est inconnu.',
  'devices.not-pending': 'Cet Appareil n’attend plus d’approbation : son code a expiré ou a déjà servi.',
  'devices.not-trusted': 'Approuve d’abord cet Appareil depuis un Appareil de confiance.',
  'devices.revoked': 'Cet Appareil a été révoqué.',
  'devices.too-many-pending': 'Trois Appareils attendent déjà leur approbation : approuve-les ou attends que leur code expire.',
  'fake-github.not-found': 'Ce fichier n’existe pas sur le faux GitHub.',
  'getting-started.runner-not-linked': 'Relie d’abord un Runner à ton compte.',
  'github.bad-signature': 'La signature de ce webhook GitHub n’est pas valide.',
  'github.branch-protected': 'Une protection de branche refuse cette écriture.',
  'github.head-moved': 'La PR a changé depuis la dernière vérification.',
  'github.process-json-invalid': 'Le fichier .process.json du dépôt n’est pas du JSON valide.',
  'github.unavailable': 'GitHub ne répond pas, réessaie dans un instant.',
  'github.user-token-refused': 'GitHub a refusé l’autorisation, reconnecte-toi.',
  'http.bad-request': 'La requête n’est pas valide.',
  'http.not-found': 'Cette adresse n’existe pas.',
  'realtime.stale': 'L’état a changé depuis ton dernier affichage : vérifie avant de recommencer.',
  'runner-dist.not-found': 'Cette version du Runner n’existe pas pour ce système.',
  'runner.link-code-expired': 'Ce code de liaison a expiré : relance la commande avec un nouveau code.',
  'runner.link-code-unknown': 'Ce code de liaison est inconnu : copie la commande affichée sur la page « Premiers pas ».',
  'runner.link-code-used': 'Ce code de liaison a déjà servi : relance la commande avec un nouveau code.',
  'runner.link-not-pending': 'Ce code de liaison n’attend pas de confirmation.',
  'runner.link-pairing-invalid': 'L’échange de clés de cette liaison n’est pas valide : relance la commande depuis la page.',
  'runner.link-rate-limited': 'Trop de tentatives de liaison : réessaie dans une minute.',
  'runner.no-engine': 'Aucun Moteur trouvé sur la machine : installe Claude Code ou Codex, puis relance la commande.',
  'runner.not-linked': 'Aucun Runner n’est relié à ton compte.',
  'runner.offline': 'Le Runner est hors ligne.',
  'runner.token-invalid': 'Ce Runner n’est plus relié à ton compte : relie-le de nouveau depuis la page « Premiers pas ».',
  'sensitive-action.stale': 'L’état a changé pendant que tu confirmais : vérifie et confirme de nouveau.',
  'server.internal': 'Une erreur inattendue est survenue.',
  'testing.unknown-scenario': 'Scénario de test inconnu.',
  'validation.invalid': 'Certaines valeurs ne sont pas valides.',
} as const satisfies Record<string, string>;

export type MessageCode = keyof typeof MESSAGES;
