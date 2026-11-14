---
id: CORE-10
title: "Sign-in with Google: OpenID Connect with PKCE, a verified address required, the same Pilote as its email Identité"
epic: CORE
type: feature
priority: P1
size: S
milestone: M1 Socle
blocked_by: [CORE-9]
adr: [0014]
risques: []
stories: [US-1]
screens: [connexion]
revue_visuelle: true
video: false
---

## Context

US-1 offers Google beside the email link and GitHub. ADR 0014: OpenID Connect, authorization code with PKCE, scopes `openid email`, `email_verified` required, `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`; « a Google identity and an email identity with the same verified address are the same Pilote », both ways; signing in with an identity no Pilote has creates one. The clients themselves are INFRA-15's gesture. Crewdeck keeps no Google token: Google only says who signs in.

## Current state of the code

- `apps/server/src/auth/auth.controller.ts`: the GitHub sign-in, its `crewdeck_oauth` cookie (`OAUTH_COOKIE`, `OAUTH_COOKIE_PATH`), `failed(error)` → `/connexion?erreur=<case>`; `oauth-state.ts`: `OauthState { state, timeZone, next }`, `sealOauthState`/`openOauthState` (HMAC with `SESSION_SECRET`, 10 min), `newState`, `sameState`, `safeNext`, `safeTimeZone`.
- `apps/server/src/config/public-config.controller.ts`: `GET /api/config`, the fake GitHub's origin `<origin>/fake-github` with `CREWDECK_FAKES=1`. `apps/server/src/testing/fake-github.controller.ts`: `/fake-github/login/oauth/authorize`, the model of a fake authorize page.
- Created by CORE-9: `pilot_identities` (`provider` `email | google | github`, `subject`, `email`, `@@unique([provider, subject])`, `@@unique([pilotId, provider])`), `PilotIdentities.pilotOf` and `signUp`, `POST /api/auth/email/verify`, `PageConnexion` v2 (actions `requestLink`, `signInWith { provider: 'github' }`, `changeEmail`; `SIGN_IN_ERRORS`), `Fakes.mail`, `zMe.identities`.
- No Google code.

## To do

- **Env** `zEnv`: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, required in production and staging (a `GOOGLE_KEYS` list); `infra/deploy/prod.env.example` and `staging.env.example` gain them with a comment pointing at INFRA-15.
- **Client** `apps/server/src/auth/google/google.client.ts`: `GOOGLE_CLIENT` token, `GoogleClient { authorizeUrl({ state, codeChallenge, nonce, redirectUri }): string; exchangeCode({ code, codeVerifier, redirectUri }): Promise<GoogleIdentity> }` with `GoogleIdentity = { sub, email, emailVerified, nonce }`. The real one: `https://accounts.google.com/o/oauth2/v2/auth` (`response_type=code`, `scope=openid email`, `code_challenge_method=S256`, `prompt=select_account`), then `POST https://oauth2.googleapis.com/token` (`grant_type=authorization_code`, the client id and secret, `code_verifier`) with `fetch`; the `id_token`'s payload decoded and checked: `iss` is `https://accounts.google.com` or `accounts.google.com`, `aud` is `GOOGLE_CLIENT_ID`, `exp` in the future, `nonce` the one sent. Any failure of Google: `AppError` 500 `auth.google-unavailable`.
- **State**: `oauth-state.ts` `OauthState` gains `codeVerifier?` and `nonce?` (sealed in the same cookie, never sent to Google but as their S256 challenge); `newCodeVerifier()` (32 random bytes, base64url) and `codeChallengeOf(verifier)`.
- **Routes** `apps/server/src/auth/google/google-auth.controller.ts` (`@Public()`):
  - `GET /api/auth/google/start?timeZone&next` → 302 to `authorizeUrl`, the state, verifier and nonce in the `crewdeck_oauth` cookie (its path covering `/api/auth/google/`);
  - `GET /api/auth/google/callback?code&state` (or `?error`) → the state checked as for GitHub (`state-mismatch`), `?error=access_denied` → `denied`, Google failing → `google-unavailable`, `emailVerified` false → `google-unverified`, each a 302 to `/connexion?erreur=<case>`; else the Pilote of the `google` Identité `sub`, else the Pilote of the `email` Identité of the lower-cased address (the `google` Identité added to it), else a new Pilote (`displayName` the address's local part, the cookie's `timeZone`); a `WebSession` opened, the cookie set, 302 to `next`.
  - Without `GOOGLE_CLIENT_ID` (development without the fakes): `start` redirects to `/connexion?erreur=google-unavailable`.
- **The other way** (`apps/server/src/auth/email/`): `POST /api/auth/email/verify` for an address without an `email` Identité but with a `google` Identité of that verified address adds the `email` Identité to that Pilote instead of creating one.
- **Fake Google** `apps/server/src/testing/fake-google.ts` (`FakeGoogle`: `seedAccount({ sub, email, emailVerified })`, `reset()`), in `Fakes` as `google` and bound to `GOOGLE_CLIENT`; `apps/server/src/testing/fake-google.controller.ts`: `GET /fake-google/authorize` redirecting at once to the `redirect_uri` with a code for the seeded account (or `?error=access_denied` when none). With the fakes, `authorizeUrl` points at `<origin>/fake-google/authorize`.
- **Page**: `PageConnexion` v3: `signInWith.provider` gains `google`; `SIGN_IN_ERRORS` gains `google-unavailable`, `google-unverified`; the Skin shows « Continuer avec Google » (secondary, no icon) above « Continuer avec GitHub ». `apps/web/src/sign-in.ts`: `providerSignInHref(provider, next, timeZone)` for both providers; `app.ts` registers `signInWith` for both.
- t() keys `connexion.google`, `connexion.error.google-unavailable` « Google ne répond pas, réessaie dans un instant. », `connexion.error.google-unverified` « Ton adresse Google n’est pas vérifiée : vérifie-la chez Google, ou reçois un lien par e-mail. »; messages `auth.google-unavailable` « Google ne répond pas, réessaie dans un instant. ».
- **Scenarios** `apps/server/src/testing/scenarios/connexion.ts`: `connexion` seeds a Google account too; Playwright `apps/web/e2e/connexion.spec.ts` gains the Google flows.

## Decisions already made

- Mockup: `connexion` (page `design/screens/crewdeck/connexion.html`; captures `design/screens/crewdeck/connexion-390.png`, `…-1280.png`). It gives the look, this ticket the scope: an element of the mockup absent from this ticket is not built, its filler text is not copied, and the screen is composed with the design system's components (`design/DESIGN.md`); the page's HTML and CSS are a reference, not code to copy. The mockup has no Google button (ADR 0014): a secondary `Button` like GitHub's, without an icon (the Passerelle's icons have no Google mark; Google's own logo is not drawn).
- The `id_token` comes straight from Google's token endpoint over TLS with the client secret: its claims are checked, its signature is not (Google's OpenID Connect guide allows it in this flow); no JWT library is added.
- PKCE and `nonce` even with a client secret (ADR 0014): a stolen code is worth nothing without the verifier sealed in the browser's cookie.
- Linking is by the verified address only, and only between `email` and `google` (ADR 0014); a GitHub Identité never joins by its address.
- Crewdeck keeps no Google token (no `access_type=offline`) and asks no `profile`: the Pilote's `avatarUrl` stays null, the Cadre shows their initials.
- A Google account whose address changed at Google stays the same Pilote (`sub`); the stored `email` is refreshed at each sign-in.

## Acceptance criteria

- [ ] Against the fake Google, « Continuer avec Google » for a new account creates a Pilote with a `google` Identité and lands on `/demarrage`; a second sign-in finds the same Pilote.
- [ ] A Pilote who signed up by email link, then signs in with Google on the same verified address, is the same Pilote with two Identités; the other order (Google first, then the email link) too.
- [ ] `email_verified` false → `/connexion?erreur=google-unverified` and its Banner, no Pilote created; a wrong `state` → `state-mismatch`; `access_denied` → `denied`.
- [ ] The authorize URL carries `code_challenge` (S256 of the sealed verifier), `nonce`, `scope=openid email`; a token response whose `aud` or `nonce` differs is refused (`google-unavailable`, unit test of the client with `msw`).
- [ ] Production and staging refuse to boot without the two Google keys.
- [ ] `PageConnexion` examples render (Google button included); `connexion` at 390 and 1280 px, axe without violations.

## Verification

- `pnpm exec nx test server -- src/auth/google/ src/auth/oauth-state.spec.ts src/config/env.spec.ts`
- `pnpm exec nx test-integration server -- auth`
- `pnpm exec nx test skin-passerelle -- src/page-connexion.spec.ts`
- `pnpm exec nx e2e web -- connexion.spec.ts`; `scripts/captures.sh connexion` for the PR.
- `pnpm exec nx affected -t lint typecheck test build --base=origin/develop`, `pnpm exec nx run contracts:generate` with no diff.

## For prod

`GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in `/opt/crewdeck/prod/.env` and `/opt/crewdeck/staging/.env` (INFRA-15) before the deploy: the boot refuses to start without them. One entry in `docs/pilotage/mep.json`.

## Out of scope

- The Google OAuth clients and their consent screen: INFRA-15. « Relier GitHub »: CORE-11. Unlinking an Identité: not in the MVP.

## Dependencies

- CORE-9.
