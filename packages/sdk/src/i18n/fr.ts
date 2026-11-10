/**
 * The French catalogue (ADR 0008), the only one at the MVP: English dotted
 * keys, grouped by page or Composant, sorted. US-28 adds the others with the
 * same keys.
 */
export const fr = {
  'router.notFound.back': 'Retour à « À toi »',
  'router.notFound.title': "Cette page n'existe pas",
} as const satisfies Record<string, string>;

export type MessageKey = keyof typeof fr;
