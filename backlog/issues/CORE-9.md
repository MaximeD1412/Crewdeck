---
id: CORE-9
title: "Sign-in by a link sent by email: Identités, Pilot.displayName, single-use 15-minute links, rate limits, the mailer and /connexion/lien"
epic: CORE
type: feature
priority: P0
size: M
milestone: M1 Socle
blocked_by: []
adr: [0014, 0008, 0007]
risques: [SEC-12]
stories: [US-1]
screens: [connexion]
revue_visuelle: true
video: false
---

## Context

US-1: « sign up with a link sent to my email, or with my GitHub or Google account, so that I do not create yet another password and need no GitHub account ». The first extreme case of the feature PRD (`docs/product/features/gestion-du-process.md`) runs with no GitHub account linked. ADR 0014: a **Pilote** has one or more **Identités** (`pilot_identities`), `Pilot.githubUserId` moves there and `login` becomes `displayName`; the email link stores only a hash, lasts 15 min, works once, and is consumed by a `POST` from the page `/connexion/lien`, never by opening it (a mail scanner follows links); 5 links per address and 20 per IP per hour (risk SEC-12). This ticket lays the Identités every sign-in uses: CORE-10 adds Google on them, CORE-11 « Relier GitHub ». The web session (ADR 0007's cookie) is unchanged.

## Current state of the code

- `apps/server/prisma/schema.prisma`: `Pilot` (`githubUserId BigInt @unique`, `login String`, `avatarUrl`, `timeZone`, `gettingStartedStep`…), `GithubUserToken`, `WebSession`; last migration `20261119000000_decisions`.
- `apps/server/src/auth/auth.controller.ts` (`@Public()`): `GET /api/auth/github/start`, `/callback` (`signIn` upserts the Pilot by `githubUserId`, `installations.linkPendingTo`, `GithubTokens.store`, `WebSessions.open`), `POST /api/auth/logout`; `oauth-state.ts` (`safeNext`, `safeTimeZone`, `DEFAULT_NEXT`), `cookies.ts`, `web-sessions.ts` (cookie `crewdeck_session`), `session.middleware.ts` (the `Origin` check only when the cookie is there).
- `apps/server/src/github/webhooks/installations.ts`: `created` finds the Pilot by `githubUserId` (`senderId`), `linkPendingTo(pilotId, githubUserId)`.
- `apps/server/src/pilots/me.controller.ts`: `ME = { id, login, avatarUrl, timeZone, gettingStartedStep }`, `toMe`, the `pilot` slice and `pilot.upserted`. `packages/contracts/src/api/me.ts` `zMe.login`; `api/testing.ts` `zTestingPilotUpdate { login }` (`testing-pilot.controller.ts`).
- `login` shown by the page: `packages/contracts/src/composants/cadre.ts` (`pilot: { login, avatarUrl }`, `skin-passerelle/src/cadre.ts`), `page-demarrage.ts` (`login`, `demarrage.runner.linked.lead` « … relié à ton compte {login}. »), `apps/web/src/views/cadre.ts`, `views/demarrage.ts`, `getting-started.ts`.
- `apps/server/src/runners/link/link-limiter.ts`: `RunnerLinkLimiter`, in memory by IP, 429 `runner.link-rate-limited` (the model of a limiter); `app.ts` sets `trust proxy` so `request.ip` is the client's.
- `apps/server/src/config/env.ts`: `zEnv`, `GITHUB_APP_KEYS`, `AUTH_KEYS` required when deployed; `infra/deploy/prod.env.example`, `staging.env.example`.
- Web: `apps/web/src/sign-in.ts` (`SIGN_IN_PATH = '/connexion'`, `signInGuard`, `signInHref`), `routes.ts` (`/connexion` → `PageConnexion`, `views/connexion.ts`), `app.ts` (`PageConnexion` `signIn` → `leave(signInHref(...))`). Composant `PageConnexion` v1 (`data { error }`, action `signIn`), `SIGN_IN_ERRORS`; Skin `packages/skin-passerelle/src/page-connexion.ts` (one « Continuer avec GitHub » button); keys `connexion.*` in `packages/sdk/src/i18n/fr.ts`.
- Fakes: `apps/server/src/testing/fakes.ts` (`github`, `runner`), scenarios `connexion`, `connexion-erreur`, `sign-in.ts` (`signInPilot` creates the Pilot with `githubUserId`); `apps/web/e2e/connexion.spec.ts`.
- No mail code, no `nodemailer`.

## To do

- **Prisma** and one migration `<timestamp>_identities` (expand only, ADR 0009: the version before keeps running on it):
  - `enum IdentityProvider { email google github }` (`identity_provider`);
  - `PilotIdentity` (`pilot_identities`): `id String @id @db.Uuid`, `pilotId` (cascade), `provider IdentityProvider`, `subject String` (the lower-cased address, Google's `sub`, GitHub's user id in decimal), `email String?` (the verified address for `email` and `google`, `null` for `github`), `login String?` (GitHub's login, `github` only), `createdAt`; `@@unique([provider, subject])`, `@@unique([pilotId, provider])`, `@@index([pilotId])`;
  - `Pilot.displayName String @map("display_name")`, filled from `login` by the migration; `githubUserId` and `login` become nullable and unread (CORE-11's migration drops them);
  - the migration copies each Pilote's `github_user_id` into a `github` identity (`subject` its decimal, `login` its login);
  - `EmailLoginToken` (`email_login_tokens`, unscoped: it exists before a Pilote): `id`, `email` (lower-cased), `tokenHash String @unique` (SHA-256 hex), `next String`, `createdAt`, `expiresAt`, `usedAt DateTime?`; `@@index([email, createdAt])`.
- **Identités** `apps/server/src/auth/identities.ts`: `PilotIdentities.pilotOf(provider, subject) → pilotId | null` (unscoped, the sign-in's lookup); `signUp(tx, { provider, subject, email, login, displayName, timeZone }) → pilotId` (the Pilot and its first identity); `GitHubInstallations.created` and `AuthController.signIn` read and write the `github` identity instead of `githubUserId` (`displayName` and `login` refreshed from GitHub at each GitHub sign-in, `avatarUrl` as before). `displayName` of a new Pilote: GitHub's login, or the address's local part (at most 39 characters).
- **Contracts** `packages/contracts/src/api/auth.ts`: `zIdentityProvider`; `zEmailLinkRequest = { email: z.email().max(254) (trimmed, lower-cased), next: string }`; `zEmailLinkVerify = { token: string (43 base64url), timeZone: string }`; `zEmailLinkVerified = { next: string }`. `api/me.ts`: `zMe.login` → `displayName`, plus `identities: [{ provider, label }]` (`label`: the address, or GitHub's login). `zTestingPilotUpdate { displayName }`.
- **Routes** `apps/server/src/auth/email/email-auth.controller.ts` (`@Public()`), both refusing an `Origin` other than the page's with 401 `auth.origin`, even without the cookie:
  - `POST /api/auth/email` (`zEmailLinkRequest`) → 204, whether or not the address is known: checks the limits (below), draws 32 random bytes (the token, base64url), stores its hash with `next` (`safeNext`) and `expiresAt` = now + 15 min, then mails `<appOrigin>/connexion/lien#<token>`; a mail the transport refuses deletes the row and answers 500 `auth.mail-unavailable`. 400 with `fields.email` « Adresse e-mail invalide. ».
  - `POST /api/auth/email/verify` (`zEmailLinkVerify`) → 200 `zEmailLinkVerified` and the `crewdeck_session` cookie: in one transaction, marks the row used only if it is unused and unexpired (`updateMany … where usedAt null and expiresAt > now`, one row or nothing), finds the `email` identity of its address or signs up a Pilote (`timeZone` through `safeTimeZone`), opens the `WebSession`. Unknown, expired or used: 422 `auth.link-invalid`, the same answer for each.
  - Limits `apps/server/src/auth/email/email-link-limiter.ts`: 20 links per IP per sliding hour, in memory as `RunnerLinkLimiter`; 5 per address per hour, counted in `email_login_tokens` (it survives a restart); past either, 429 `auth.too-many-requests`.
  - `EmailLoginTokensSweep` (`@nestjs/schedule`, hourly): rows older than 24 h deleted.
  - Messages in `apps/server/src/errors/messages.ts`: `auth.too-many-requests` « Trop de liens demandés : réessaie dans une heure. », `auth.link-invalid` « Ce lien de connexion n’est plus valable : demande-en un nouveau. », `auth.mail-unavailable` « L’e-mail n’a pas pu partir, réessaie dans un instant. ».
  - The logger's redaction list (CORE-1) gains `email` and `token` for these two routes.
- **Mail** `apps/server/src/auth/mail/`: `mailer.ts` (`MAILER` token, `Mailer { send({ to, subject, text, html }): Promise<void> }`, `SmtpMailer` on `nodemailer.createTransport(SMTP_URL)` from `MAIL_FROM`); `sign-in-link.ts` `signInLinkMail(url) → { subject, text, html }`: subject « Ton lien de connexion à Crewdeck », body « Clique sur ce lien pour te connecter à Crewdeck : <url>. Il est valable 15 minutes et ne sert qu’une fois. Si tu n’as rien demandé, ignore ce message. », the HTML with one link and no image nor tracker. `nodemailer` and `@types/nodemailer` added through the pnpm catalog.
- **Env** `zEnv`: `SMTP_URL` (`smtp://` or `smtps://`) and `MAIL_FROM`, required in production and staging (a `MAIL_KEYS` list beside `AUTH_KEYS`); `prod.env.example` and `staging.env.example` gain them with a comment pointing at INFRA-14.
- **Fake mail** `apps/server/src/testing/fake-mailer.ts` (`FakeMailer`: keeps the mails, `reset()`), in `Fakes` as `mail` and bound to `MAILER` by `TestingModule`; outside the fakes and with `SMTP_URL` unset (unit and integration tests, development), `MAILER` is a `FakeMailer` too. `GET /api/testing/mails?to=<address>` → the mails kept for that address, newest first (testing module only).
- **Page**:
  - `PageConnexion` v2 (`packages/contracts/src/composants/page-connexion.ts`): data `{ error: SignInError | null, sentTo: string | null, emailError: string | null, busy: boolean }`, `SIGN_IN_ERRORS` gaining `too-many-requests`, `mail-unavailable`, `link-invalid`; actions `requestLink { email }`, `signInWith { provider: 'github' }` (replacing `signIn`), `changeEmail {}`. Skin: the title and lead, the halt Banner of `error`, a `TextField` « Ton adresse e-mail » (`name: email`) and the primary « Recevoir un lien » (icon `send`, loading while `busy`), the line « ou », the secondary « Continuer avec GitHub » (icon `github`), the help; with `sentTo`, in place of the field and its button, a go Banner « Lien envoyé à <sentTo> » with « Ouvre-le dans les 15 minutes, sur cet appareil ou un autre. » and the ghost « Changer d’adresse » (`changeEmail`).
  - `PageConnexionLien` (`page-connexion-lien.ts`, tag `cd-page-connexion-lien`, bare Cadre): data `{ state: 'ready' | 'busy' | 'invalid' }`, actions `confirm {}`, `restart {}`: title « Connexion à Crewdeck », lead « Un clic pour te connecter sur cet appareil. », primary « Se connecter »; `invalid`: the halt Banner « Ce lien de connexion n’est plus valable : demande-en un nouveau. » and the primary « Recevoir un nouveau lien » (`restart`).
  - Web: `apps/web/src/api/auth.ts` gains `requestLink(email, next)` and `verifyLink(token, timeZone)`; `sign-in.ts`: `/connexion/lien` open signed out like `/connexion` (signed in, both go to « À toi »), `signInHref` renamed `githubSignInHref`; `views/connexion.ts` keeps the form's state (`sentTo`, `emailError` from a 400's `fields.email`, `error` from a 429 or 500's code); `views/connexion-lien.ts`: at load the page reads the token from `location.hash`, removes it with `history.replaceState`, keeps it in memory only; `confirm` posts it and on 200 `leave(next)` (a full load, as the GitHub sign-in); no token in the hash → `invalid`. Route `/connexion/lien` → `PageConnexionLien` in `routes.ts`.
  - `displayName` everywhere `login` was shown: `Cadre` v+1 (`pilot.displayName`), `PageDemarrage` v+1 (`displayName`, « … relié à ton compte {name}. »), their views and examples.
  - t() keys `connexion.*` (email field, « ou », the sent state, the three new errors), `connexionLien.*`, `composants.PageConnexionLien.*`; `connexion.help` becomes « Pas de mot de passe : un lien par e-mail, ou ton compte GitHub. ».
- **Scenarios** `apps/server/src/testing/scenarios/connexion.ts`: `connexion` unchanged in name (the email field shows), `connexion-lien-envoye` (the sent state, for the captures), `connexion-lien` (a link drawn for `pilote@example.com`, the page `/connexion/lien#<token>`); `signInPilot` writes the Pilot with its `github` identity. Playwright `apps/web/e2e/connexion.spec.ts` gains the email flow.
- `docs/pilotage/risques.json`: SEC-12's two solutions ticked, status « implémenté », `statutDepuis` the merge's date.

## Decisions already made

- Mockup: `connexion` (page `design/screens/crewdeck/connexion.html`; captures `design/screens/crewdeck/connexion-390.png`, `…-1280.png`). It gives the look, this ticket the scope: an element of the mockup absent from this ticket is not built, its filler text is not copied, and the screen is composed with the design system's components (`design/DESIGN.md`); the page's HTML and CSS are a reference, not code to copy. The mockup shows GitHub only (ADR 0014): the email field goes above « Continuer avec GitHub », which becomes secondary; the sent state and `/connexion/lien` have no mockup and use the existing Composants (Banner, TextField, Button) in the bare Cadre.
- The token travels in the fragment (`#`): it never reaches a server's log, a proxy nor a `Referer`. The page removes it from the address bar before anything else.
- One answer (204) for a known and an unknown address, one code (`auth.link-invalid`) for an unknown, expired and used link: nothing tells whether an address has an account.
- An unknown address creates its Pilote at `verify`, not at the request: a typo creates no account.
- The link opens on any browser: the Pilote signed in is the one who clicks « Se connecter », the `next` stored at the request; `timeZone` is the clicking browser's.
- At most one Identité per provider per Pilote (`@@unique([pilotId, provider])`): one address, one Google account, one GitHub account; changing one is not in the MVP.
- The address of an `email` or `google` Identité is readable by the server (it sends the mail; ADR 0003's table, identifiers); it is never logged.
- 429 is the status of both limits (ADR 0008 amended by ADR 0014); the per-IP count is in memory like `RunnerLinkLimiter` (one server process at the MVP), the per-address count in the table.
- The mail's French copy lives in `apps/server/src/auth/mail/sign-in-link.ts`, as the error messages live in `messages.ts`: the server has no `t()`.
- `displayName` is the Pilote's readable name; no field edits it at the MVP.

## Acceptance criteria

- [ ] `POST /api/auth/email` for a new address answers 204, stores only the token's hash, and the fake mailer holds one mail to that address whose link is `<origin>/connexion/lien#<43 characters>`; for a known address the same 204 and mail.
- [ ] Opening the link shows « Se connecter » and creates nothing; the click signs in (cookie set), a new address getting a Pilote with an `email` Identité and `displayName` its local part, landing on `/demarrage`; the address bar no longer holds the token.
- [ ] The same link a second time, a link older than 15 min, and a made-up token each give 422 `auth.link-invalid` and the page's « Recevoir un nouveau lien ».
- [ ] Two `verify` of the same token at once: exactly one session is opened.
- [ ] The sixth request for one address within an hour, and the twenty-first from one IP, answer 429 `auth.too-many-requests`; the page shows « Trop de liens demandés : réessaie dans une heure. ».
- [ ] A transport that throws: 500 `auth.mail-unavailable`, no row left; a `POST` with another `Origin`: 401 `auth.origin`.
- [ ] The migration turns an existing Pilote's `github_user_id` into a `github` Identité: signing in with GitHub afterwards finds the same Pilote; an installation made before sign-up is linked at sign-in as before.
- [ ] `GET /api/me` returns `displayName` and `identities`; the Cadre and « Premiers pas » show `displayName`.
- [ ] Neither the address nor the token appears in the server's logs of the two routes (a test reads the logger's output).
- [ ] `PageConnexion` and `PageConnexionLien` examples render and their actions emit valid `cd-action`s; the scenarios `connexion`, `connexion-lien-envoye` and `connexion-lien` at 390 and 1280 px, axe without violations.

## Verification

- `pnpm exec nx test server -- src/auth/`
- `pnpm exec nx test-integration server -- auth`
- `pnpm exec nx test contracts -- src/api/auth.spec.ts`
- `pnpm exec nx test skin-passerelle -- src/page-connexion.spec.ts src/page-connexion-lien.spec.ts`
- `pnpm exec nx test web -- src/sign-in.spec.ts src/views/connexion.spec.ts src/views/connexion-lien.spec.ts`
- `pnpm exec nx e2e web -- connexion.spec.ts`; `scripts/captures.sh connexion` for the PR (only ids of `design/screens.json` are captured: the sent state and `/connexion/lien` have no mockup, their e2e runs axe at 390 and 1280 px, and the PR body adds two screenshots of them taken by that spec).
- `pnpm exec nx affected -t lint typecheck test build --base=origin/develop`, `pnpm exec nx run contracts:generate` with no diff.

## For prod

- `SMTP_URL` and `MAIL_FROM` in `/opt/crewdeck/prod/.env` and `/opt/crewdeck/staging/.env` (INFRA-14) before the deploy: the boot refuses to start without them. One entry in `docs/pilotage/mep.json`.
- The migration `<timestamp>_identities` (expand only), run by the deploy: one entry in `docs/pilotage/mep.json`.

## Out of scope

- Google: CORE-10. « Relier GitHub », a Pilote without GitHub on `POST /api/github/token`, dropping `pilots.github_user_id` and `pilots.login`: CORE-11.
- Changing an Identité's address, removing an Identité, editing `displayName`: not in the MVP.

## Dependencies

- None.
