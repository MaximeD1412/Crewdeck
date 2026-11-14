---
id: CORE-11
title: "« Relier GitHub » from the Paramètres, and a Pilote without GitHub: 409 github.not-linked, never signed out by GitHub"
epic: CORE
type: feature
priority: P1
size: M
milestone: M1 Socle
blocked_by: [CORE-9, PARAM-1]
adr: [0014, 0002]
risques: []
stories: [US-1]
screens: [parametres]
revue_visuelle: true
video: false
---

## Context

ADR 0014: GitHub is the App's user authorization (ADR 0002), both to sign in and to « Relier GitHub » from the Paramètres; « a GitHub identity joins a Pilote only through « Relier GitHub » while signed in: GitHub's address may be private or unverified ». A Pilote without it can follow no Dépôt GitHub: the getting started offers a folder of the Runner's machine (PROJET-6) or « Relier GitHub ». Since CORE-9, a Pilote may have no GitHub Identité at all; the code still assumes one: `POST /api/github/token` answers 401 `auth.github-expired` (the page then signs out), and a refused GitHub grant ends every session of the Pilote even when they signed in by email. This ticket makes GitHub optional and linkable.

## Current state of the code

- `apps/server/src/auth/auth.controller.ts`: `GET /api/auth/github/start`, `/callback` (`signIn`: the Pilote of the `github` Identité, else a new one; `GithubTokens.store`; `GitHubInstallations.linkPendingTo(pilotId, githubUserId)`); `oauth-state.ts` (`OauthState`), `cookies.ts` (`OAUTH_COOKIE_PATH = '/api/auth/github'`).
- `apps/server/src/auth/github-tokens.ts`: `GithubTokens.current()` (no row → 401 `auth.github-expired`), `expire()` deletes the tokens and every `WebSession` of the Pilote, closes their sockets, 401 `auth.github-expired`. `github-token.controller.ts`: `POST /api/github/token`. Web `apps/web/src/api/github-token.ts` (`githubToken.get()`).
- `apps/server/src/github/reconciliation/reconciliation.service.ts`: `Reconciliation.run()` over every linked installation, `ReconcileHooks`; `webhooks/installations.ts` (`linkPendingTo`, `linked()`).
- `PageDemarrage` (`packages/contracts/src/composants/page-demarrage.ts`, `skin-passerelle/src/page-demarrage.ts`, `apps/web/src/views/demarrage.ts`): the `projects` step (the RepositoryPicker once PROJET-2 is merged).
- Created by CORE-9: `pilot_identities` (`provider`, `subject`, `email`, `login`, `@@unique([pilotId, provider])`), `PilotIdentities`, `Pilot.displayName`, `pilots.github_user_id` and `pilots.login` nullable and unread, `zMe.identities [{ provider, label }]`, `pilot.upserted` carrying `zMe`.
- Created by PARAM-1: `/parametres`, `PageParametres` with its Emplacements (`roles`, `notifications`, `schedules`, `optional-steps`, `projects`, `account`, `modders`), the « Compte » Card (time zone) in `account`, `apps/web/src/views/parametres.ts`.

## To do

- **Linking** `apps/server/src/auth/github-link.controller.ts` (not public: the session's Pilote):
  - `GET /api/auth/github/link?next=<path>` → 302 to GitHub's authorize page, as `start`, the sealed state gaining `intent: 'link'` and the session's `pilotId`;
  - the shared `GET /api/auth/github/callback`, for `intent: 'link'`: the request's session must be the sealed `pilotId`'s, else `state-mismatch`; GitHub's user then:
    - is this Pilote's `github` Identité (a reconnection): tokens stored again;
    - is another Pilote's: nothing stored, 302 to `<next>?erreur=github-already-linked`;
    - is none, and this Pilote has another `github` Identité: `<next>?erreur=github-other-account`;
    - is none: the `github` Identité added (`subject`, `login`), the tokens stored, `linkPendingTo`, `pilot.upserted` in the same transaction, then `Reconciliation.runFor(pilotId)` (new: the hooks over that Pilote's linked installations, not awaited) so that their Dépôts GitHub arrive without waiting 15 min;
    - then 302 to `next` (`safeNext`, `/parametres` by default). `?error=access_denied` → `<next>?erreur=denied`; GitHub failing → `<next>?erreur=github-unavailable`.
- **Without GitHub** (`apps/server/src/auth/github-tokens.ts`):
  - `current()` for a Pilote with no `github` Identité, or one whose tokens are gone: 409 `github.not-linked` « Relie ton compte GitHub dans les Paramètres pour continuer. »;
  - `expire()`: a Pilote whose only Identité is GitHub is signed out as today (401 `auth.github-expired`); one with another Identité keeps their sessions, loses only the tokens, and gets 409 `github.not-linked`.
  - `apps/server/src/auth/require-github.ts` `requireGithub(tx, pilotId)`: throws the same 409; the routes that need the Pilote's GitHub user call it (`POST /api/github/token` through `current()`).
  - Web `apps/web/src/api/github-token.ts`: a 409 `github.not-linked` rejects with `GithubNotLinkedError`, never signs the page out.
- **Contracts** `api/me.ts`: each `identities` item gains `reconnect: boolean` (`github` without tokens); `zMe.githubLinked` (a `github` Identité with its tokens).
- **Paramètres**: Composant `AccountIdentities` (`packages/contracts/src/composants/account-identities.ts`, tag `cd-account-identities`, category `partie`; `packages/skin-passerelle/src/account-identities.ts`), placed in PARAM-1's `account` Emplacement before « Compte »: a Card « Connexion » with one `ListRow` per Identité (title « E-mail », « Google » or « GitHub », meta its `label`), then for GitHub without an Identité the `ListRow` « GitHub » with meta « pas relié · pour suivre tes Dépôts GitHub » and the secondary « Relier GitHub », for GitHub with `reconnect` the meta « à reconnecter » and « Reconnecter GitHub »; after a failed link, a halt Banner above the rows with its message. Data `{ identities: [{ provider, label, reconnect }], error: 'github-already-linked' | 'github-other-account' | 'denied' | 'github-unavailable' | null }`, action `linkGitHub {}` (the core leaves for `/api/auth/github/link?next=/parametres`). View in `apps/web/src/views/parametres.ts` from the `pilot` slice and `?erreur=`.
- **Premiers pas**: `PageDemarrage` v+1, data `githubLinked`, action `linkGitHub`: on the `projects` step, for a Pilote without GitHub, a caution Banner above the step's content « Pour suivre un Dépôt GitHub, relie d’abord ton compte GitHub. » with the secondary « Relier GitHub » (→ `/api/auth/github/link?next=/demarrage`).
- **Migration** `<timestamp>_drop_pilot_github_columns`: drops `pilots.github_user_id` and `pilots.login`, unread since CORE-9's release.
- t() keys `parametres.identities.*`, `demarrage.github.*`; messages `github.not-linked`.
- **Scenarios** `apps/server/src/testing/scenarios/parametres.ts`: `parametres` (a Pilote signed in by email, GitHub not linked); `signInPilot` takes the Identités to seed. Playwright `apps/web/e2e/parametres.spec.ts` gains « Relier GitHub »; `demarrage.spec.ts` the Banner.

## Decisions already made

- Mockup: `parametres` (page `design/screens/crewdeck/parametres.html`; captures `design/screens/crewdeck/parametres-390.png`, `…-1280.png`). It gives the look, this ticket the scope: an element of the mockup absent from this ticket is not built, its filler text is not copied, and the screen is composed with the design system's components (`design/DESIGN.md`); the page's HTML and CSS are a reference, not code to copy. The mockup has no place for the Identités: the « Connexion » Card goes in the `account` Emplacement, before PARAM-1's « Compte », with `Card`, `ListRow`, `Button` and `Banner`.
- One callback URL for sign-in and linking: the App has one (INFRA-11); the sealed `intent` tells them apart, and a link needs the very session that started it.
- A GitHub account already another Pilote's is refused, never moved nor merged: merging two Pilotes is not in the MVP.
- Signing in with GitHub to a Pilote that linked GitHub to an email account finds that Pilote (the `github` Identité), as any Identité.
- A GitHub grant that expires signs out only the Pilote for whom GitHub is the only way in; for the others it is a « Reconnecter GitHub », not a sign-out.
- 409 for `github.not-linked`, as ADR 0014's consequences name it: the request is right, the account is not in the state it needs.
- Unlinking GitHub is not in the MVP: the Projets on GitHub would lose their reads.

## Acceptance criteria

- [ ] A Pilote signed in by email link clicks « Relier GitHub » in the Paramètres, goes through the fake GitHub and comes back to `/parametres` with the « GitHub » row showing the login; `GET /api/me` has `githubLinked: true`; an installation that GitHub user made before is now theirs and its repositories are reconciled at once.
- [ ] Linking a GitHub account that is another Pilote's leaves both unchanged and shows « Ce compte GitHub est déjà relié à un autre compte Crewdeck. »; linking a second GitHub account shows « Ton compte Crewdeck est déjà relié à un autre compte GitHub. ».
- [ ] The callback of a link with another session's cookie, or none, is `state-mismatch` and links nothing.
- [ ] `POST /api/github/token` for a Pilote without GitHub: 409 `github.not-linked`, the session kept; the page is not signed out.
- [ ] A refused refresh for a Pilote with an email Identité: tokens deleted, sessions kept, 409, the row shows « Reconnecter GitHub »; for a GitHub-only Pilote: signed out, 401 `auth.github-expired` as before.
- [ ] On `/demarrage`'s `projects` step, a Pilote without GitHub sees the Banner and « Relier GitHub », which comes back to `/demarrage`.
- [ ] `AccountIdentities`' examples render and `linkGitHub` emits a valid `cd-action`; `parametres` at 390 and 1280 px, axe without violations.

## Verification

- `pnpm exec nx test server -- src/auth/`
- `pnpm exec nx test-integration server -- auth`
- `pnpm exec nx test skin-passerelle -- src/account-identities.spec.ts src/page-demarrage.spec.ts`
- `pnpm exec nx test web -- src/api/github-token.spec.ts src/views/parametres.spec.ts`
- `pnpm exec nx e2e web -- parametres.spec.ts demarrage.spec.ts`; `scripts/captures.sh parametres` for the PR.
- `pnpm exec nx affected -t lint typecheck test build --base=origin/develop`, `pnpm exec nx run contracts:generate` with no diff.

## For prod

- The migration dropping `pilots.github_user_id` and `pilots.login`: it ships only after a release with CORE-9 (the version before must not read them); one entry in `docs/pilotage/mep.json`.

## Out of scope

- The folder path of the getting started: PROJET-6. Unlinking an Identité, merging two Pilotes: not in the MVP. Google: CORE-10.

## Dependencies

- CORE-9.
- PARAM-1.
