import { randomBytes } from 'node:crypto';
import { EMAIL_LINK_TTL_SECONDS } from '@crewdeck/contracts';
import { hashOf, LINK_PATH } from '../../auth/email/email-links.js';
import { newId } from '../../ids.js';
import { defineScenario } from './define.js';
import { seedGitHubUser } from './sign-in.js';

/** The address of the scenarios' sign-in links. */
export const LINK_ADDRESS = 'pilote@example.com';

/** The sign-in page (`design/screens.json`: `connexion`), nobody signed in: its email field, and « Continuer avec GitHub », which signs the fake user in. */
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

/**
 * The sign-in page once a link is sent (`connexion`, state `lien-envoye`, no
 * mockup): the page of `connexion`, whose form the capture sends for
 * `pilote@example.com` (`apps/web/e2e/captures.spec.ts`); the link lands in
 * the fake mailer.
 */
export const connexionLienEnvoye = defineScenario({
  name: 'connexion-lien-envoye',
  path: '/connexion',
  seed: seedGitHubUser,
});

/**
 * The page of a sign-in link (`/connexion/lien`, no mockup): a link drawn for
 * `pilote@example.com`, its token in the fragment, as the mail gives it. «
 * Se connecter » signs that address up.
 */
export const connexionLien = defineScenario({
  name: 'connexion-lien',
  path: LINK_PATH,
  seed: async ({ prisma }) => {
    const token = randomBytes(32).toString('base64url');
    const now = new Date();
    await prisma.unscoped.emailLoginToken.create({
      data: {
        id: newId(),
        email: LINK_ADDRESS,
        tokenHash: hashOf(token),
        next: '/a-toi',
        createdAt: now,
        expiresAt: new Date(now.getTime() + EMAIL_LINK_TTL_SECONDS * 1000),
      },
    });
    return { path: `${LINK_PATH}#${token}` };
  },
});
