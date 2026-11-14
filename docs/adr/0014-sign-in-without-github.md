# Sign-in by email link, Google or GitHub; GitHub linked when a Projet needs it

> **Status:** accepted, 2026-11-14. Amends [ADR 0002](0002-github-app.md)
> on sign-in: the App's user authorization is one way in, and « Relier
> GitHub » from the Paramètres.

## Context

US-1 asks for sign-up with a link sent by email, or with a GitHub or Google
account, « so that I need no GitHub account »; the first extreme case of
the [feature PRD](../product/features/gestion-du-process.md) runs with no
GitHub account linked. On 2026-11-13 a Pilote was a GitHub user
(`Pilot.githubUserId` unique, `apps/server/src/auth/`).

## Decision

- **A Pilote has one or more identities**: `pilot_identities` (`pilotId`,
  `provider` `email | google | github`, `subject`: the lower-cased address,
  Google's `sub`, GitHub's user id; `email`, `createdAt`), unique on
  `(provider, subject)`. `Pilot.githubUserId` moves there; `login` becomes
  `displayName`. The web session ([ADR 0007](0007-real-time.md)'s cookie) is
  unchanged.
- **Email link**: `POST /api/auth/email { email }` answers 204 whether or not
  the address is known. It stores the hash of a random 32-byte token
  (`email_login_tokens`: `email`, `tokenHash`, `expiresAt` 15 min, `usedAt`)
  and mails `/connexion/lien#<token>`; that page shows « Se connecter » and
  posts the token (`POST /api/auth/email/verify`), so that a mail scanner
  opening the link uses nothing. Single use. An unknown address creates the
  Pilote. At most 5 links per address and 20 per IP per hour: 429
  `auth.too-many-requests` (a status ADR 0008 did not list).
- **Mail**: SMTP through `nodemailer`, `SMTP_URL` and `MAIL_FROM` in the
  environment; Brevo at the MVP (EU, swapped by changing the URL). The mail is
  French, its template in `apps/server/src/auth/mail/`. Tests use a fake
  transport that keeps the mails.
- **Google**: OpenID Connect, authorization code with PKCE, scopes `openid
  email`, `email_verified` required; `GOOGLE_CLIENT_ID` and
  `GOOGLE_CLIENT_SECRET`.
- **GitHub**: the App's user authorization, as in
  [ADR 0002](0002-github-app.md), both to sign in and to « Relier GitHub »
  from the Paramètres; its user token is kept as before. A Pilote without
  it can follow no Dépôt GitHub: the getting started offers a folder of the
  Runner's machine or « Relier GitHub ».
- **Linking**: a Google identity and an email identity with the same
  verified address are the same Pilote. A GitHub identity joins a Pilote
  only through « Relier GitHub » while signed in: GitHub's address may be
  private or unverified. Signing in with an identity no Pilote has creates
  one.

## Options that lost

- **Merging accounts on GitHub's email**: an unverified address would open
  someone else's account.
- **A link opened by `GET` signing in**: mail scanners follow links.
- **A provider's HTTP API for mail**: one more client to swap; SMTP is
  common to every provider.

## Consequences

- Two `externe` tickets: the Brevo account and its sender domain (SPF,
  DKIM, DMARC) with `SMTP_URL` for staging and production; the Google OAuth
  clients (production and staging) and their secrets.
- `connexion.html` shows GitHub only: the ticket describes the email field
  and the Google button with the existing Composants.
- Risk SEC-12 (a sign-in link intercepted or phished).
