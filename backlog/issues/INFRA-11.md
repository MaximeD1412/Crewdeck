---
id: INFRA-11
title: "Create the GitHub Apps « Crewdeck » and « Crewdeck staging » (permissions, events, URLs) and keep their secrets"
epic: INFRA
type: externe
priority: P1
size: S
milestone: M0 Skeleton and delivery
blocked_by: [BIZ-1]
adr: [0002, 0010]
risques: [SEC-2]
stories: [US-1, US-3]
screens: []
revue_visuelle: false
video: false
reprend: 100
---

## Context

ADR 0002: one GitHub App per environment, created by hand, is the product's sign-in (US-1), its way to follow repositories (US-3), its webhooks and its merges. Its private key, client secret and webhook secret are the server's only GitHub secrets. The URLs need the domain bought in BIZ-1. Code never calls the real Apps in tests (fake GitHub, CORE-3); this ticket is the gesture that lets staging and production work. ADR 0010 adds five events (`pull_request_review_comment`, `issue_dependencies`, `release`, `label`, `milestone`), so that every object the Runner's **Miroir** copies has its webhook (MIROIR-1) and the Boucle learns blocked-by changes (BOUCLE-1).

## Current state of the code

- Created by INFRA-5: `infra/deploy/prod.env.example` and `staging.env.example` with the keys `GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_APP_PRIVATE_KEY` (base64 of the PEM), `GITHUB_WEBHOOK_SECRET`.
- The routes the URLs point at are built by CORE-4 (`/api/auth/github/callback`), PROJET-1 (`/api/github/webhooks`) and PROJET-2 (the setup URL after an installation, `/projets`).

## To do

For each App, in the founder's GitHub account (Settings > Developer settings > GitHub Apps > New GitHub App), with `<domain>` from BIZ-1 and `<host>` = `<domain>` (« Crewdeck ») or `staging.<domain>` (« Crewdeck staging »):

- [ ] Name « Crewdeck » / « Crewdeck staging »; homepage `https://<host>`.
- [ ] Callback URL `https://<host>/api/auth/github/callback`; « Expire user authorization tokens » checked (8 h tokens with refresh tokens); « Request user authorization (OAuth) during installation » unchecked; « Enable Device Flow » unchecked.
- [ ] Setup URL `https://<host>/projets`, « Redirect on update » checked.
- [ ] Webhook active, URL `https://<host>/api/github/webhooks`, secret: 32 random bytes (`openssl rand -hex 32`), different per App.
- [ ] Repository permissions: Metadata read; Contents read and write; Issues read and write; Pull requests read and write; Checks read; Commit statuses read; Workflows read and write. No Administration, no organization permission. Account permissions: none (email comes from the user token's profile).
- [ ] Subscribe to events: Installation and Installation repositories (always sent), Issues, Issue comment, Sub issues, Issue dependencies, Pull request, Pull request review, Pull request review comment, Check suite, Check run, Status, Push, Release, Label, Milestone.
- [ ] An App created before this list had the last five: in its « Permissions & events », tick Issue dependencies, Pull request review comment, Release, Label and Milestone, then « Save changes » (no permission changes: the installations need no new approval).
- [ ] « Where can this GitHub App be installed? »: « Only on this account » at the MVP (making it public is a Bêta gesture).
- [ ] Generate a private key (`.pem`) and a client secret.
- [ ] In the password manager, one entry per App: App ID, slug, client ID, client secret, the `.pem` file, the webhook secret.
- [ ] Comment on this ticket with the two App slugs and IDs (not secret) and the date; never a secret.

## Decisions already made

- Permissions exactly as ADR 0002 lists them, events as ADR 0002 and ADR 0010 list them; a later need is a new ADR, not a checkbox.
- The App posts as `crewdeck[bot]` (prod) and `crewdeck-staging[bot]` (staging); the Review verdict is Crewdeck's, not a GitHub approval (ADR 0002).
- The secrets reach the server in INFRA-12 only, through the VPS's env files; none goes into a GitHub Actions secret.

## Acceptance criteria

- [ ] Two Apps exist with the permissions, the 16 events and the URLs above; their secrets are in the password manager.
- [ ] Each App's « Advanced » tab shows its webhook URL (deliveries fail until INFRA-12, expected).

## Verification

- GitHub > the App > « Permissions & events »: compare with the list above.

## For prod

In `docs/pilotage/mep.json`: the two Apps, done; their secrets to put on the VPS in INFRA-12.

## Out of scope

- Putting the secrets on the server and the first deploy: INFRA-12. Making the App public: Bêta.

## Dependencies

- BIZ-1.
