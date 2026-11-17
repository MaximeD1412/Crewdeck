import { z } from 'zod';

/**
 * Signing in (US-1, ADR 0014): a Pilote has one Identité per provider, the
 * address of a link sent by email, a Google account (CORE-10) or a GitHub
 * account. The `subject` of each is the lower-cased address, Google's `sub`
 * or GitHub's user id.
 */
export const IDENTITY_PROVIDERS = ['email', 'google', 'github'] as const;
export const zIdentityProvider = z.enum(IDENTITY_PROVIDERS);
export type IdentityProvider = z.infer<typeof zIdentityProvider>;

/** How long a sign-in link lasts, from its request: 15 minutes, once. */
export const EMAIL_LINK_TTL_SECONDS = 15 * 60;
/** The links one address may ask for in a sliding hour. */
export const EMAIL_LINKS_PER_ADDRESS_PER_HOUR = 5;
/** The links one IP may ask for in a sliding hour. */
export const EMAIL_LINKS_PER_IP_PER_HOUR = 20;

const INVALID_EMAIL = 'Adresse e-mail invalide.';

/**
 * `POST /api/auth/email` (public): mails a sign-in link to `email`, trimmed
 * and lower-cased, and answers 204 whether or not a Pilote has it. `next` is
 * the page to land on once signed in (a path of the site, else `/a-toi`).
 * 400 `fields.email` for what is not an address, 429
 * `auth.too-many-requests` past 5 links per address or 20 per IP in an hour,
 * 500 `auth.mail-unavailable` when the mail could not leave.
 */
export const zEmailLinkRequest = z.object({
  email: z
    .string({ error: INVALID_EMAIL })
    .trim()
    .toLowerCase()
    .pipe(z.email({ error: INVALID_EMAIL }).max(254, { error: INVALID_EMAIL })),
  next: z.string(),
});
export type EmailLinkRequest = z.input<typeof zEmailLinkRequest>;

/** The token of a link, in its fragment (`/connexion/lien#<token>`): 32 random bytes in base64url. */
export const zEmailLinkToken = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

/**
 * `POST /api/auth/email/verify` (public), posted by the page `/connexion/lien`
 * when the Pilote clicks « Se connecter », never by opening the link: uses
 * the link once and signs the browser in. `timeZone` is the clicking
 * browser's, the new Pilote's. 422 `auth.link-invalid` for a link unknown,
 * expired or already used, the same answer for each.
 */
export const zEmailLinkVerify = z.object({ token: zEmailLinkToken, timeZone: z.string() });
export type EmailLinkVerify = z.infer<typeof zEmailLinkVerify>;

/** The answer of `verify`, with the session cookie: the page stored with the link, where the page goes. */
export const zEmailLinkVerified = z.object({ next: z.string().startsWith('/') });
export type EmailLinkVerified = z.infer<typeof zEmailLinkVerified>;
