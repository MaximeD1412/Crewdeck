---
id: CORE-4
title: "Sign in with GitHub: Pilot, encrypted user tokens, session cookie, /api/github/token"
epic: CORE
type: feature
priority: P0
size: M
milestone: M1 Socle
blocked_by: [CORE-2, CORE-3, UI-3]
adr: [0002, 0006, 0008]
risques: []
stories: [US-1]
screens: [connexion]
revue_visuelle: true
video: false
---

## Context

US-1: « As a Pilote, I want to sign up with my GitHub account, so that I do not create yet another password. » ADR 0002: sign-in is the GitHub App's user authorization (OAuth web flow); the user access token (8 h) and its refresh token are kept by the server, encrypted at rest with `GITHUB_TOKEN_KEY`; the browser gets a fresh access token from `POST /api/github/token` to read GitHub itself (documents, diffs, captures). ADR 0008: the Pilote's time zone comes from the browser at sign-up. Every authenticated route from here on uses the session this ticket creates; CORE-5's WebSocket authenticates with its cookie.

## Current state of the code

- Created by CORE-2: `Pilot` (`pilots`: `id`, `githubUserId`, `login`, `timeZone`, `seq`), `apps/server/src/scope/` (`ScopeGuard` reading `req.principal`, `@Public()`, `runInPilotScope`).
- Created by CORE-3: `GitHubClient` (`authorizeUrl`, `exchangeCode`, `refreshUserToken`, `getAuthenticatedUser`), `FakeGitHub` and `/fake-github/login/oauth/authorize`, `GET /api/config`, `apps/server/src/config/env.ts`.
- Created by UI-1 to UI-3: the Skin runtime, the router, `t()`, `Button`, `Banner`, the Cadre with its `bare` variant.
- Created by INFRA-4: Playwright at 390 and 1280 px with axe, the scenarios mechanism (`apps/server/src/testing/`, `POST /api/testing/scenarios/:name`), `scripts/captures.sh`.

## To do

- Environment: `APP_URL` (the page's origin), `GITHUB_TOKEN_KEY` (32 bytes, base64), `SESSION_SECRET` (32 bytes, base64); `.env.example` updated.
- Prisma (`apps/server/prisma/schema.prisma`):
  - `Pilot` gains `avatarUrl String? @map("avatar_url")`;
  - `GithubUserToken { pilotId String @id @db.Uuid; accessTokenEnc Bytes; accessExpiresAt DateTime @db.Timestamptz; refreshTokenEnc Bytes; refreshExpiresAt DateTime @db.Timestamptz; keyVersion Int; updatedAt DateTime @updatedAt }` (`github_user_tokens`, scoped);
  - `WebSession { id String @id @db.Uuid; pilotId String @db.Uuid; tokenHash String @unique; createdAt; lastSeenAt; expiresAt; userAgent String? }` (`web_sessions`, scoped, index `[pilotId]`).
- `apps/server/src/auth/`:
  - `token-cipher.ts`: AES-256-GCM with `GITHUB_TOKEN_KEY` (`node:crypto`), 12-byte random nonce, stored as `version(1) | nonce | ciphertext | tag`; `encrypt(text)`, `decrypt(bytes)`;
  - `auth.controller.ts` (`@Public()`):
    - `GET /api/auth/github/start?timeZone=<IANA>&next=<path>`: sets the short-lived cookie `crewdeck_oauth` (HttpOnly, 10 min, HMAC-signed with `SESSION_SECRET`: `state`, `timeZone`, `next`), redirects 302 to `authorizeUrl(state, APP_URL + '/api/auth/github/callback')`; `next` must be a path starting with `/` (else `/a-toi`);
    - `GET /api/auth/github/callback?code&state` (or `?error=access_denied`): checks `state` against the cookie, `exchangeCode`, `getAuthenticatedUser`, upserts the `Pilot` by `githubUserId` (`login`, `avatarUrl` refreshed; `timeZone` set only at creation, from the cookie, validated against `Intl.supportedValuesOf('timeZone')`, else `UTC`), upserts its `GithubUserToken`, creates a `WebSession`, sets `crewdeck_session`, redirects to `next`. On failure redirects to `/connexion?erreur=<case>` with `state-mismatch`, `denied` or `github-unavailable`;
  - `POST /api/auth/logout` → 204: deletes the `WebSession`, clears the cookie;
  - `session.middleware.ts`: reads `crewdeck_session`, looks up `sha256(token)` (unscoped, the only lookup before a scope exists), sets `req.principal = { kind: 'pilot', pilotId }`, slides `expiresAt` (30 days) at most once an hour; for any non-`GET` request checks `Origin === APP_URL`, else 401 `auth.origin`;
  - `github-token.controller.ts`: `POST /api/github/token` → `{ accessToken, expiresAt }`, refreshing when less than 5 min remain; a refused refresh deletes the Pilote's sessions and answers 401 `auth.github-expired`, « Ta connexion GitHub a expiré, reconnecte-toi. ».
- `apps/server/src/pilots/`: `GET /api/me` → `zMe` (`packages/contracts/src/api/me.ts`): `{ id, login, avatarUrl, timeZone }`. RUNNER-3 adds the Pilot field `gettingStartedStep` to it and the redirect to `/demarrage`; this ticket has no getting-started gate.
- Cookie `crewdeck_session`: 32 random bytes base64url, HttpOnly, `Secure` outside development, `SameSite=Lax`, `Path=/`, 30 days.
- Web:
  - `apps/web/src/api/auth.ts` (`me()`, `logout()`), `apps/web/src/api/github-token.ts` (cached until 1 min before `expiresAt`, used later by the content reads);
  - router guard (`apps/web/src/router.ts`): `/api/me` 401 → `/connexion?next=<current>`; a signed-in Pilote on `/connexion` → `/a-toi`;
  - Composant `PageConnexion` (`packages/contracts/src/composants/page-connexion.ts`, tag `cd-page-connexion`): data `{ error: 'state-mismatch' | 'denied' | 'github-unavailable' | null }`, action `signIn: {}`; implementation `packages/skin-passerelle/src/page-connexion.ts` inside the Cadre `bare` variant; the core handles `signIn` by navigating to `/api/auth/github/start?timeZone=<Intl.DateTimeFormat().resolvedOptions().timeZone>&next=<next>`;
  - copy `connexion.*` in `packages/sdk/src/i18n/fr.ts`: title « Bienvenue sur Crewdeck », lead « Pilote tes Projets avec des agents IA, de l'Idée au Ticket livré, en temps réel. », button « Continuer avec GitHub », help « Tu te connectes avec ton compte GitHub : aucun mot de passe de plus à retenir. », errors `connexion.error.state-mismatch` « La connexion n'a pas abouti, recommence. », `connexion.error.denied` « Tu as refusé l'accès à GitHub : Crewdeck en a besoin pour suivre tes Projets. », `connexion.error.github-unavailable` « GitHub ne répond pas, réessaie dans un instant. ».
- Scenario `apps/server/src/testing/scenarios/connexion.ts` (signed out; and `connexion-erreur`), Playwright `apps/web/e2e/connexion.spec.ts`.

## Decisions already made

- Mockup: `connexion` (page `design/screens/crewdeck/connexion.html`; captures `design/screens/crewdeck/connexion-390.png`, `…-1280.png`). It gives the look, this ticket the scope: an element of the mockup absent from this ticket is not built, its filler text is not copied, and the screen is composed with the design system's components (`design/DESIGN.md`); the page's HTML and CSS are a reference, not code to copy.
- The error state has no mockup: a `Banner` of tone `halt` above the button, with the message of `connexion.error.*` (noted as a design gap).
- Sign-up and sign-in are the same gesture: the first callback creates the Pilot.
- Server-side sessions with a hashed token, not JWTs: logout and « GitHub expired » must end them at once.
- No CSRF token: `SameSite=Lax` plus the `Origin` check on every non-`GET`.
- The user token never goes into the page's storage beyond memory.

## Acceptance criteria

- [ ] Against `FakeGitHub`, the callback with a valid `state` creates the Pilot with the browser's time zone, stores both tokens encrypted (the stored bytes do not contain the token), sets the cookie and redirects to `next`.
- [ ] A second sign-in of the same GitHub user updates `login` and keeps the first `timeZone`.
- [ ] A wrong `state` redirects to `/connexion?erreur=state-mismatch`; `?error=access_denied` to `?erreur=denied`; the page shows the matching banner.
- [ ] `POST /api/github/token` returns the token, refreshes it when it expires within 5 min, and answers 401 `auth.github-expired` (sessions deleted) when the refresh is refused.
- [ ] `GET /api/me` without cookie → 401 `auth.required`; with another Pilote's session id forged → 401; a `POST` with a foreign `Origin` → 401 `auth.origin`.
- [ ] `POST /api/auth/logout` → 204, and the same cookie is then refused.
- [ ] An integration test proves another Pilote's `WebSession` row is invisible to a scoped query (the first real scoped table, CORE-2).
- [ ] Playwright: `/a-toi` signed out lands on `/connexion?next=%2Fa-toi`; « Continuer avec GitHub » goes through the fake authorize and lands on `/a-toi`; 390 and 1280 px, axe without violations.

## Verification

- `pnpm exec nx test server -- src/auth/ src/pilots/`
- `pnpm exec nx test-integration server -- auth`
- `pnpm exec nx e2e web -- connexion.spec.ts`
- `scripts/captures.sh apps/web/e2e/connexion.spec.ts`
- `pnpm exec nx affected -t lint typecheck test build --base=origin/develop`

## For prod

`APP_URL`, `GITHUB_TOKEN_KEY` and `SESSION_SECRET` in the server's `.env` of staging and production (generated by INFRA-12; a second copy of `GITHUB_TOKEN_KEY` in the founder's password manager, losing it signs every Pilote out); the App's callback URL `<APP_URL>/api/auth/github/callback` set on both GitHub Apps (INFRA-11). One element each in `docs/pilotage/mep.json`.

## Out of scope

- `/demarrage`, the Pilot field `gettingStartedStep` and its redirect: RUNNER-3 (the `ai-accounts` rule: RUNNER-7).
- Editing the time zone in the Paramètres: PARAM-1.
- The WebSocket's authentication by the cookie: CORE-5.

## Dependencies

- CORE-2.
- CORE-3.
- UI-3.
