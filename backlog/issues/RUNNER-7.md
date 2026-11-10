---
id: RUNNER-7
title: "Comptes IA: crewdeck-runner login, what each Moteur can really run and why not, the getting-started gate"
epic: RUNNER
type: feature
priority: P0
size: M
milestone: M2 Runner and Projets
blocked_by: [RUNNER-3, RUNNER-4, RUNNER-5]
adr: [0004, 0003, 0008]
risques: [IA-1, IA-2, IA-3]
stories: [US-38]
screens: [demarrage-comptes-ia, demarrage-comptes-ia-aucun, runner]
revue_visuelle: true
video: false
---

## Context

US-38: the Pilote connects their Comptes IA on their Runner (their Claude or Codex sign-in where the provider allows it, else their API key) and sees which Moteurs and models they can really use, and why one is not (« connexion requise », « quota atteint », « indisponible avec cet abonnement »); getting started needs at least one usable Moteur. The product never holds an AI credential (PRD, « Principles »): the Runner keeps it and sends only what is usable. This ticket also builds the « Runner et Comptes IA » page's Moteurs, connection and Runner cards; its usage card is RUNNER-13.

## Current state of the code

- Created by RUNNER-4: `apps/runner/internal/engine/` (`Engine.Capabilities`, `Registry`), `packages/contracts/src/runner/engines.ts` (`zEngineCapabilities`); by RUNNER-5 and RUNNER-6 if merged: the real adapters (else only the fake one is registered in tests).
- Created by RUNNER-3: the Runner link, `~/.crewdeck/runner.json`, the service, `/demarrage` with its `runner` step, the Pilot field `gettingStartedStep` and `POST /api/me/getting-started/advance`, the router's redirection to `/demarrage`.
- Created by RUNNER-2: `apps/server/src/runners/` (gateway, handler registry, presence, `runner` slice), `apps/runner/internal/protocol/`.
- Created by UI-2/UI-3/UI-5: Card, ListRow, StatusBadge, CodeBlock, Banner, Button, KeyValue, PageHeader, the Cadre.
- No `AiAccount`, no `login` command, no `/runner` page.

## To do

- **Runner** (Go):
  - `apps/runner/internal/accounts/`: `Store` of API keys in the OS keychain through `github.com/zalando/go-keyring` (service `crewdeck-runner`, user `<engine>`), falling back to `~/.crewdeck/secrets/<engine>.key` (mode 600, folder 700) when no keychain answers (WSL without Secret Service); `Get(engine)`, `Set(engine, key)`, `Delete(engine)`. Adapters get the key as `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` in `StartOptions.Env`.
  - `crewdeck-runner login claude|codex`:
    - `claude`: asks « Abonnement Claude ou clé API ? » (`1`/`2`). Subscription: runs the unmodified `claude` interactively with `/login` as RUNNER-1 recorded, the Pilote signs in in their terminal. API key: hidden input (`golang.org/x/term`), stored by `accounts.Store`.
    - `codex`: API key only (hidden input), stored.
    - Then recomputes the capabilities and sends them; prints the usable models.
  - `crewdeck-runner logout claude|codex`: deletes the stored key (a subscription stays the binary's own: the command says how to sign out of it).
  - Capabilities sent with a new protocol message `capabilities` `{ engines: zEngineCapabilities[] }` on each `hello.accepted`, after `login`/`logout`, every 10 min, and whenever an adapter emits `auth-required` or `limit-reached` (the model concerned becomes `quota-reached` until the window's `resetsAt`).
- **Server** `apps/server/src/runners/ai-accounts/`:
  - Prisma `AiAccount` (`ai_accounts`): `id`, `pilotId`, `engine` (unique per Pilote), `installed`, `version?`, `knownVersion`, `kind` (`subscription`|`api-key`|`none`), `state` (`connected`|`login-required`), `models` (JSON array `{ id, label, usable, reason? }`), `reportedAt`. No credential field, ever.
  - The `capabilities` handler upserts each engine's row with `ai-account.upserted` in the same transaction.
  - `GET /api/ai-accounts` (the Pilote's, at most one per Moteur), `StateContributor` key `aiAccounts`, contract `packages/contracts/src/api/ai-accounts.ts`; a helper `usableModels(pilotId)` for PARAM-2 and PROJET-3.
  - The getting-started rule: advancing from `ai-accounts` needs at least one usable model, else 422 `getting-started.no-usable-engine` (« Connecte au moins un Compte IA utilisable. »).
- **Web**:
  - `/demarrage` step `ai-accounts` (view `apps/web/src/views/demarrage.ts`, Composant `PageDemarrage` extended): one Card per Moteur (title « Claude Code », « Codex ») with its account StatusBadge (« connecté · abonnement », « connecté · clé API », « connexion requise »), its models as ListRows with their StatusBadge (« disponible » go, « quota atteint » caution, « indisponible » halt with meta « indisponible avec cet abonnement »), the CodeBlock `crewdeck-runner login <moteur>` when not connected; the Banner « Aucun Moteur utilisable » and the disabled « Continuer » when none is usable; the help lines of the mockup.
  - `/runner` page `PageRunner` (`packages/contracts/src/composants/page-runner.ts`, `packages/skin-passerelle/src/page-runner.ts`, view `apps/web/src/views/runner.ts`): the cards « Moteurs et modèles » (each model a ListRow: model id, meta « <Moteur> · Compte IA <Claude|Codex> » or the reason), « Connecter un Compte IA » (CodeBlock `crewdeck-runner login claude`), « Runner » (state badge « en ligne » / « hors ligne depuis HH:MM », machine, system, version, the encryption line). It leaves an Emplacement `usage` at the top for RUNNER-13.
  - The Cadre's menu entry « Runner et Comptes IA » points to `/runner`.
  - Copy keys `aiAccounts.*`, `demarrage.aiAccounts.*`, `runner.*`.
- **Fake Runner**: `apps/server/src/testing/fake-runner.ts` sends the scenario's capabilities; scenarios `apps/server/src/testing/scenarios/demarrage.ts` (`demarrage-comptes-ia`, `demarrage-comptes-ia-aucun`) and `scenarios/runner.ts` (`runner`).

## Decisions already made

- Mockup: `demarrage-comptes-ia`, `demarrage-comptes-ia-aucun`, `runner` (pages `design/screens/crewdeck/demarrage-comptes-ia.html`, `…/demarrage-comptes-ia-aucun.html`, `…/runner.html`; captures `…-390.png`, `…-1280.png`). It gives the look, this ticket the scope: an element of the mockup absent from this ticket is not built, its filler text is not copied, and the screen is composed with the design system's components (`design/DESIGN.md`); the page's HTML and CSS are a reference, not code to copy. The « Usage des Comptes IA » card of `runner` is RUNNER-13.
- Reason ids are English in data (`login-required`, `quota-reached`, `not-in-plan`), French only through `t()` (« connexion requise », « quota atteint », « indisponible avec cet abonnement »).
- Codex is API key only at the MVP (risk IA-2); Claude by subscription or API key (risk IA-1: the API key path always exists).
- A Moteur whose version is not known (`knownVersion: false`) stays usable; its card adds « version non vérifiée » (caution badge) (risk IA-3).
- The page never offers to type a key: « Sur ta machine, jamais ici ».

## Acceptance criteria

- [ ] `login codex` with a key stores it in the keychain (fake keyring) or the mode-600 file, and the next `capabilities` says `connected · api-key` with its models usable.
- [ ] `login claude` offers subscription or API key; the subscription path runs `claude` with `/login` (fake binary).
- [ ] No request from the Runner to the server, and no `ai_accounts` column, contains a key (asserted on the recorded protocol messages).
- [ ] The server stores the capabilities and emits `ai-account.upserted`; `GET /api/ai-accounts` matches its schema; 401 without a session; another Pilote's accounts are never returned.
- [ ] A `limit-reached` from an adapter makes the model `quota-reached` until `resetsAt`.
- [ ] On `/demarrage`, « Continuer » is disabled with the Banner when no model is usable, and enabled as soon as one is (real time, no reload); the API refuses with `getting-started.no-usable-engine`.
- [ ] `/runner` shows the Moteurs, the connection command and the Runner card, online and offline.
- [ ] The three screens pass Playwright at 390 and 1280 px with axe.

## Verification

- `cd apps/runner && go test ./internal/accounts/ ./cmd/crewdeck-runner/`
- `pnpm exec nx test server -- src/runners/ai-accounts/`
- `pnpm exec nx test-integration server -- ai-accounts`
- `pnpm exec nx e2e web -- demarrage.spec.ts`
- `pnpm exec nx e2e web -- runner.spec.ts`
- `scripts/captures.sh apps/web/e2e/demarrage.spec.ts apps/web/e2e/runner.spec.ts`
- `pnpm exec nx affected -t lint typecheck test build --base=origin/develop`

## For prod

Nothing.

## Out of scope

- Usage, windows, spend and their projection: RUNNER-13. The Rôles' Moteur and model: PARAM-2.
- The « Runner hors ligne » Banner of `runner-hors-ligne`: ATOI-3.
- `crewdeck-runner status`: RUNNER-8.

## Dependencies

- RUNNER-3.
- RUNNER-4.
- RUNNER-5 (the Claude Code adapter lists the models and runs `claude` for its sign-in; the Codex side lands with RUNNER-6 and is tested on the fake Moteur until then).
