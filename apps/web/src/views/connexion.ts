import { zSignInError, type ComposantData, type PageConnexion } from '@crewdeck/sdk';

export type ConnexionView = ComposantData<typeof PageConnexion>;

/** The sign-in page's data from its query: `?erreur=<case>` of a failed callback, an unknown case read as none. */
export const connexionView = (query: Readonly<Record<string, string>>): ConnexionView => ({
  error: zSignInError.safeParse(query['erreur']).data ?? null,
});
