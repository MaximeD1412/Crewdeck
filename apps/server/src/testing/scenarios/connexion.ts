import { defineScenario } from './define.js';
import { seedGitHubUser } from './sign-in.js';

/** The sign-in page (`design/screens.json`: `connexion`), nobody signed in; « Continuer avec GitHub » signs the fake user in. */
export const connexion = defineScenario({
  name: 'connexion',
  path: '/connexion',
  seed: seedGitHubUser,
});

/** The sign-in page after a callback whose `state` did not match (`connexion`, state `erreur`, a design gap): its halt Banner. */
export const connexionErreur = defineScenario({
  name: 'connexion-erreur',
  path: '/connexion?erreur=state-mismatch',
  seed: seedGitHubUser,
});
