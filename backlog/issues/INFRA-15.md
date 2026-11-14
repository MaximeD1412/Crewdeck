---
id: INFRA-15
title: "Create the Google OAuth clients « Crewdeck » and « Crewdeck staging » (consent screen, scopes openid email, redirect URI) and keep their secrets"
epic: INFRA
type: externe
priority: P1
size: S
milestone: M0 Skeleton and delivery
blocked_by: []
adr: [0014, 0009]
risques: []
stories: []
screens: []
revue_visuelle: false
video: false
hors_boucle: true
---

## Context

ADR 0014: a Pilote can sign in with their Google account (US-1, CORE-10), through OpenID Connect (authorization code with PKCE, scopes `openid email`, `email_verified` required), with `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in the environment. A Google OAuth client is created by hand in the Google Cloud console, one per environment, as the GitHub Apps are (INFRA-11). Code never calls Google in tests (CORE-10's fake Google); this ticket is the gesture that lets staging and production sign in with Google. Values are never committed (ADR 0009, « Secrets »).

## Current state of the code

- No Google code on `develop`; `apps/server/src/config/env.ts` has no Google key.
- Created by CORE-10: `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in `zEnv` (required in production and staging) and in `infra/deploy/prod.env.example` and `staging.env.example`; the routes `GET /api/auth/google/start` and `GET /api/auth/google/callback`.
- Created by INFRA-12: `/opt/crewdeck/prod/.env` and `/opt/crewdeck/staging/.env`.

## To do

For each environment, with `<domain>` from BIZ-1 and `<host>` = `<domain>` (« Crewdeck ») or `staging.<domain>` (« Crewdeck staging »):

- [ ] **Project**: console.cloud.google.com, with the founder's Google account, « New project » `crewdeck-production` / `crewdeck-staging`, no organisation, no billing account (sign-in needs none).
- [ ] **Branding** (Google Auth Platform > « Branding »): app name « Crewdeck » / « Crewdeck staging »; user support email and developer contact the founder's address; app home page `https://<host>`; authorised domain `<domain>` (it covers `staging.<domain>`); no logo (a logo asks for a brand verification).
- [ ] **Audience**: user type « External »; publishing status « Testing »; test users: the founder's Google address (later the Bêta's testers, at most 100).
- [ ] **Data access**: scopes `openid` and `.../auth/userinfo.email` only (both non-sensitive); no `profile`, no other API.
- [ ] **Client** (« Clients » > « Create client »): type « Web application », name `crewdeck-<env>-server`; « Authorised redirect URIs »: `https://<host>/api/auth/google/callback`, exactly (scheme, no trailing slash); no « Authorised JavaScript origins » (the exchange is the server's).
- [ ] Copy the client ID and the client secret at once (the console shows the secret only at creation; « Download JSON » keeps both).
- [ ] **Password manager**: one entry per environment « Crewdeck Google <env> »: project, client ID, client secret.
- [ ] **Env files** on the VPS (once INFRA-12 wrote them; if not yet, the values wait in the password manager and INFRA-12 writes them): `GOOGLE_CLIENT_ID=` and `GOOGLE_CLIENT_SECRET=` of that environment's client in `/opt/crewdeck/<prod|staging>/.env`; then delete the downloaded JSON.
- [ ] Once CORE-10 is deployed on staging: on `https://staging.<domain>/connexion`, « Continuer avec Google » with the founder's account comes back signed in; another Google account (not a test user) gets Google's « Accès bloqué » page.
- [ ] Update `docs/pilotage/mep.json`: CORE-10's items about the Google keys done (a PR, or ask an agent).
- [ ] Comment on this ticket with the two project ids and client IDs (not secret) and the date; never a secret.

## Decisions already made

- Two Google Cloud projects, not two clients of one: the consent screen names the environment, and a staging secret never opens production.
- « Testing » at the MVP, the founder's account as its test user: the MVP is the founder's own use. Publishing the app (« In production », with its home page and privacy policy) is a Bêta gesture, like making the GitHub App public (INFRA-11).
- Scopes `openid email` only (ADR 0014): Crewdeck reads the account's `sub` and verified address, never its name, photo nor any Google data; it keeps no Google token (no `access_type=offline`), so « Testing »'s 7-day limit on refresh tokens does not apply.

## Acceptance criteria

- [ ] Two clients exist, each in its project, with the one redirect URI above, scopes `openid` and `email`, status « Testing » with the founder as test user.
- [ ] Their IDs and secrets are in the password manager and in their env file (mode 600), nowhere else.

## Verification

- Google Auth Platform > « Clients » > the client: compare with the list above.
- `sudo grep -c '^GOOGLE_CLIENT_SECRET=.\+' /opt/crewdeck/prod/.env /opt/crewdeck/staging/.env`

## For prod

This ticket is the release's gestures for Google; `docs/pilotage/mep.json` updated as above.

## Out of scope

- The OpenID Connect flow and the fake Google: CORE-10. The mail provider: INFRA-14. Publishing the consent screen: Bêta.

## Dependencies

- None. The domain comes from BIZ-1 and the env files from INFRA-12, both done before this gesture in practice; without them the values wait in the password manager.
