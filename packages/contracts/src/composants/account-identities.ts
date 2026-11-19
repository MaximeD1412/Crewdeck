import { z } from 'zod';
import { zIdentityProvider } from '../api/auth.js';
import { defineComposant } from './define.js';

/**
 * Why the last « Relier GitHub » failed (CORE-11): the cases of the callback
 * of a link (`/parametres?erreur=<case>`). `github-already-linked`: that
 * GitHub account is another Pilote's; `github-other-account`: this Pilote's
 * `github` Identité is another GitHub account.
 */
export const LINK_ERRORS = ['github-already-linked', 'github-other-account', 'denied', 'github-unavailable'] as const;
export const zLinkError = z.enum(LINK_ERRORS);
export type LinkError = z.infer<typeof zLinkError>;

/**
 * The Pilote's Identités in the Paramètres (ADR 0014, CORE-11), in the
 * `account` Emplacement: a Card « Connexion » with one row per Identité (its
 * provider, its address or login); a GitHub not linked is a row « GitHub »
 * with « Relier GitHub », one whose tokens are gone « à reconnecter » with
 * « Reconnecter GitHub », both `linkGitHub` (the core leaves for
 * `/api/auth/github/link`). After a failed link, a halt Banner above the rows
 * with the message of its case (`parametres.identities.error.<case>`).
 */
export const AccountIdentities = defineComposant({
  name: 'AccountIdentities',
  version: 1,
  tag: 'cd-account-identities',
  category: 'partie',
  description: 'Les Identités du Pilote dans les Paramètres, et « Relier GitHub ».',
  data: z.object({
    identities: z.array(z.object({ provider: zIdentityProvider, label: z.string(), reconnect: z.boolean() })),
    error: zLinkError.nullable(),
  }),
  actions: {
    linkGitHub: z.object({}),
  },
  slots: [],
  examples: [
    { name: 'sans GitHub', data: { identities: [{ provider: 'email', label: 'pilote@example.com', reconnect: false }], error: null } },
    {
      name: 'GitHub relié',
      data: {
        identities: [
          { provider: 'email', label: 'pilote@example.com', reconnect: false },
          { provider: 'github', label: 'octocat', reconnect: false },
        ],
        error: null,
      },
    },
    {
      name: 'à reconnecter',
      data: {
        identities: [
          { provider: 'email', label: 'pilote@example.com', reconnect: false },
          { provider: 'github', label: 'octocat', reconnect: true },
        ],
        error: null,
      },
    },
    {
      name: 'déjà relié ailleurs',
      data: { identities: [{ provider: 'email', label: 'pilote@example.com', reconnect: false }], error: 'github-already-linked' },
    },
    {
      name: 'autre compte GitHub',
      data: { identities: [{ provider: 'github', label: 'octocat', reconnect: true }], error: 'github-other-account' },
    },
    { name: 'accès refusé', data: { identities: [{ provider: 'google', label: 'pilote@example.com', reconnect: false }], error: 'denied' } },
    {
      name: 'GitHub indisponible',
      data: { identities: [{ provider: 'email', label: 'pilote@example.com', reconnect: false }], error: 'github-unavailable' },
    },
  ],
});
