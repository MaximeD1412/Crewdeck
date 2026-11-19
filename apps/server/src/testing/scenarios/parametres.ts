import { defineScenario } from './define.js';
import { seedParametresAccount } from './parametres-projet.js';

/**
 * The Paramètres of the account (`design/screens.json`: `parametres`), the
 * Pilote signed in by email, GitHub not linked (« Connexion » offers « Relier
 * GitHub », CORE-11), their Runner online with both Comptes IA (Claude Code by
 * subscription, Codex by API key, GPT-5.5 Pro at its quota): « Rôles et
 * modèles » as the mockup shows it, the Idée on Sonnet 5.5 (stored), the
 * Conception and the Code on Opus 5.5 and the Review on GPT-5.5 (their
 * defaults), then the Rôle the Pilote added, « Revue Codex » on GPT-5.5;
 * « Compte » with the time zone; « Par Projet », Crewdeck and Personal OS
 * inheriting the account, Site mairie with two Paramètres changed; « Pour les
 * Moddeurs ». The other sections are their tickets'.
 */
export const parametres = defineScenario({
  name: 'parametres',
  path: '/parametres',
  seed: (ctx) => seedParametresAccount(ctx, { worktree: false, signIn: { identities: ['email'] } }),
});
