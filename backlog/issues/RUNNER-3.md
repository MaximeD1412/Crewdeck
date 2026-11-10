---
id: RUNNER-3
title: "Linking the Runner: link code, install script, link command, user service and the getting-started screens"
epic: RUNNER
type: feature
priority: P0
size: M
milestone: M2 Runner and Projets
blocked_by: [RUNNER-2, E2E-1, UI-3]
adr: [0003, 0004, 0008, 0009]
risques: [SEC-4]
stories: [US-2]
screens: [demarrage, demarrage-liaison-echouee, demarrage-runner-relie]
revue_visuelle: true
video: false
---

## Context

US-2: the Pilote installs the Runner on Linux, macOS or Windows (WSL) with one command and links it to their account; a failed link says why and gives the command again. It is the first step of the getting started (« Premiers pas » : Runner, Comptes IA, Projets). ADR 0004 gives the install command, the commands and the failure reasons; ADR 0003 the link code (a short id the server knows and a 128-bit secret the browser drew and never sends). This ticket builds the link and the screens; the key exchange that uses the secret is E2E-2, which fills the opaque `pairing` fields this ticket carries.

## Current state of the code

- Created by RUNNER-2: `apps/server/src/runners/` (model `Runner` with `tokenHash`, presence, `RunnerGateway`, `GET /api/runner`, the `runner` state slice and `runner.upserted`), `packages/contracts/src/runner/` (protocol), `apps/runner/internal/protocol/`, `apps/runner/internal/state/` (`~/.crewdeck/runner.json`), `apps/runner/cmd/crewdeck-runner/` with `run`.
- Created by E2E-1: `apps/web/src/keys/` and `apps/runner/internal/keys/` (X25519, HPKE wrap, HMAC helpers, Crockford base32).
- Created by UI-3: the Cadre `cd-app-shell` with its bare variant; by UI-2: Button, Banner, Tabs, CodeBlock, Card, ListRow, KeyValue, PageHeader; by UI-6 (if merged) or this ticket: ProcessTrack and CheckRow (see Decisions).
- Created by CORE-4: `Pilot`, the session cookie, `/connexion`; by CORE-6: the store, the router `apps/web/src/router.ts`; by INFRA-4: Playwright and `scripts/captures.sh`, the scenarios mechanism `apps/server/src/testing/`; by INFRA-5: the server image.
- No link code, no install script, no getting-started page.

## To do

- **Link codes** (server, `apps/server/src/runners/link/`):
  - Prisma model `RunnerLinkCode` (`runner_link_codes`): `id`, `pilotId`, `shortId` (4 Crockford base32 characters, unique among live codes), `state` (`waiting`|`pending`|`linked`|`failed`|`expired`), `failureReason?` (`expired`|`already-used`|`unsupported-system`|`no-engine`), `browserPairing` (JSON, opaque here), `runnerPairing?` (JSON, opaque), `pendingRunner?` (JSON: machine, os, arch, wsl, runnerVersion, engines), `expiresAt` (created + 10 min), `createdAt`.
  - `POST /api/runner/link-codes` (session) body `{ pairing: object }` → `201 { id, shortId, expiresAt }`; a new code expires the Pilote's previous `waiting` one.
  - `POST /api/runner/link` (no session; called by the binary) body `{ shortId, machine, os, arch, wsl, runnerVersion, engines: string[] }`: 404 `runner.link-code-unknown`; 422 `runner.link-code-expired`, `runner.link-code-used`, `runner.no-engine` (empty `engines`: the code becomes `failed` with `no-engine`); else the code becomes `pending` with the Runner's data, and the answer is `202 { linkId, browserPairing }`. Rate limit: 10 attempts per minute per IP, then 429 `runner.link-rate-limited`.
  - `POST /api/runner/link/:linkId/pairing` (no session; the binary, right after) body `{ pairing: object }` → 204; stores `runnerPairing` (409 `runner.link-not-pending` if the code is not `pending` or already has one).
  - `POST /api/runner/link-failures` (no session; called by `install.sh`) body `{ shortId, reason: 'unsupported-system', os, arch }` → 204; marks the code `failed`.
  - `POST /api/runner/link-codes/:id/confirm` (session) body `{ pairing: object, seq }`: only for a `pending` code that has its `runnerPairing` (else 409 `runner.link-not-pending`); creates the `Runner` row (token generated, hash stored), revokes the Pilote's previous Runner (`revokedAt`, its socket closed with 4401), marks the code `linked`. Returns 200 `{ runner }`.
  - `GET /api/runner/link/:linkId` (no session; polled by the binary every 2 s for at most 10 min) → `{ state: 'pending' }`, or `{ state: 'linked', runnerId, token, pairing }` exactly once (the token is returned once, then the field is gone), or `{ state: 'failed', reason }`.
  - The code's state is part of the `runner` state slice (`link: { id, shortId, state, failureReason?, expiresAt } | null`) and written with `runner.upserted`; expiry is applied by a sweep every 30 s.
  - Contracts in `packages/contracts/src/api/runner-link.ts`.
- **Distribution** (server):
  - Nx target `runner:dist`: builds `crewdeck-runner` for linux/darwin × amd64/arm64 with `CGO_ENABLED=0` into `dist/runner/<version>/<os>-<arch>/crewdeck-runner` and its `.sha256`; the Dockerfile of INFRA-5 copies `dist/runner/` to `/app/runner-dist/` (add it if INFRA-5 did not).
  - `GET /runner/install.sh` (rendered with `PUBLIC_URL` and the current version), `GET /runner/:version/:os-:arch` and `GET /runner/:version/:os-:arch.sha256` from `RUNNER_DIST_DIR` (default `/app/runner-dist`); 404 for an unknown version or platform.
  - `apps/runner/install/install.sh` (POSIX sh): parse `--link <code>` and `--server <url>`; detect `uname -s`/`uname -m` and WSL (`/proc/version` contains `microsoft`); unsupported → `POST /api/runner/link-failures` and exit 1 with the French message; download, check the SHA-256, install to `~/.local/bin/crewdeck-runner` (mode 755), then `exec crewdeck-runner link <code> --server <url>`.
- **Runner** (Go):
  - `crewdeck-runner link <code> [--server <url>]`: split the code `<shortId>-<secret>`; look for the Moteurs on `PATH` (`claude`, `codex`); call `POST /api/runner/link` with the machine facts, then `POST /api/runner/link/:linkId/pairing` with the pairing produced by `internal/keys` from the `browserPairing` it got (E2E-2 fills both; until then `{}`); poll `GET /api/runner/link/:linkId`; on `linked`, write `runner.json` (mode 600), install the user service, start it, print « Runner relié à ton compte. ». Every failure prints its reason in French and the install command again: `expired`, `already-used`, `unknown`, `no-engine`, `server-unreachable` (no answer within 10 s, 3 tries).
  - `apps/runner/internal/service/`: systemd `--user` unit `~/.config/systemd/user/crewdeck-runner.service` (`ExecStart=%h/.local/bin/crewdeck-runner run`, `Restart=on-failure`), `systemctl --user enable --now`; launchd `~/Library/LaunchAgents/com.crewdeck.runner.plist` with `launchctl bootstrap gui/<uid>`; WSL without systemd: print how to enable it (`/etc/wsl.conf` `[boot] systemd=true`, `wsl --shutdown`) and that `crewdeck-runner run` works in the foreground.
- **Getting started** (web):
  - Pilot field `gettingStartedStep` (`runner`|`ai-accounts`|`projects`|`done`, default `runner`) in `GET /api/me`, and `POST /api/me/getting-started/advance` body `{ from, seq }` → the next step, 422 `getting-started.runner-not-linked` when advancing from `runner` without a linked Runner. RUNNER-7 adds the rule of `ai-accounts`, PROJET-2 builds the `projects` step (until then the page shows an Empty with « Continuer » to `done`).
  - The router sends every page but `/connexion` and `/demarrage` to `/demarrage` while `gettingStartedStep !== 'done'`.
  - `PageDemarrage` Composant (contract in `packages/contracts/src/composants/page-demarrage.ts`, Skin implementation in `packages/skin-passerelle/src/page-demarrage.ts`), view `apps/web/src/views/demarrage.ts`, in the bare Cadre. Runner step: the ProcessTrack (Runner, Comptes IA, Projets), the OS Tabs (Linux, macOS, Windows (WSL): same command, a help line per OS), the CodeBlock with the full command, the waiting CheckRow, the card « Ce qui reste chez toi »; failure state with the halt Banner of the reason and a new command; linked state with the go Banner, the machine KeyValue and « Continuer ». The page draws the code (secret from `crypto.getRandomValues`) on load and on « Réessayer », and confirms a `pending` code once its `runnerPairing` is there (the pairings' crypto is E2E-2's).
  - Copy keys under `demarrage.runner.*` in `packages/sdk/src/i18n/fr.ts`.
- **Scenarios and tests**: `apps/server/src/testing/scenarios/demarrage.ts` (`demarrage`, `demarrage-liaison-echouee`, `demarrage-runner-relie`), `apps/web/e2e/demarrage.spec.ts` at 390 and 1280 px with axe.

## Decisions already made

- Mockup: `demarrage`, `demarrage-liaison-echouee`, `demarrage-runner-relie` (pages `design/screens/crewdeck/demarrage.html`, `…/demarrage-liaison-echouee.html`, `…/demarrage-runner-relie.html`; captures `…-390.png`, `…-1280.png`). It gives the look, this ticket the scope: an element of the mockup absent from this ticket is not built, its filler text is not copied, and the screen is composed with the design system's components (`design/DESIGN.md`); the page's HTML and CSS are a reference, not code to copy.
- The code is `<shortId>-<secret>`: 4 characters, a dash, 26 Crockford base32 characters (128 bits). The mockup's `7KQ4-M2PX` is too short for ADR 0003: the command shows the full code (it is copied, never typed), the CheckRow and the Banner show only « code 7KQ4 ».
- The server never sees the secret; it only routes the two opaque pairings. A Runner exists only once the browser confirmed the pending link: a guessed short id can never link a machine on its own.
- If UI-6 is not merged yet, ProcessTrack and CheckRow are built here in `packages/skin-passerelle/` following UI-6's contract names (`ProcessTrack`, `CheckRow`); UI-6 then only adds the others.
- The install command uses `PUBLIC_URL` of the environment; `--server` is added only when the page is served from another origin than prod (staging, dev).
- « Server unreachable » is known only to the Runner: the page keeps waiting, and the Runner prints the reason.

## Acceptance criteria

- [ ] The page draws a code, shows the command with the full code and « En attente du Runner… · code 7KQ4 »; the secret never appears in a request to the server (asserted on the recorded requests of the e2e test).
- [ ] `crewdeck-runner link` with a valid code makes it `pending`; the page confirms it; the binary gets its token once, writes `runner.json` mode 600, installs and starts the service; the page shows « Runner relié » with the machine, the system and the version.
- [ ] Linking a second Runner revokes the first: its token is refused (4401) and `GET /api/runner` returns the new one.
- [ ] An expired code (10 min, fake clock), a used code, an unsupported system and a machine without Moteur each make the page show its Banner and a new command, and the binary print its French reason and the command again.
- [ ] `install.sh` refuses a wrong checksum and installs to `~/.local/bin`.
- [ ] Routes: nominal cases match their schemas; 400 with `fields`; 401 without a session on the session routes; 404 for another Pilote's code; 409 on confirming a code not `pending`; 422 for each business rule; 429 after 10 attempts.
- [ ] A Pilote with `gettingStartedStep: 'runner'` opening `/a-toi` lands on `/demarrage`.
- [ ] The three screens pass Playwright at 390 and 1280 px with axe.

## Verification

- `pnpm exec nx test server -- src/runners/link/`
- `pnpm exec nx test-integration server -- runner-link`
- `pnpm exec nx e2e web -- demarrage.spec.ts`
- `cd apps/runner && go test ./cmd/crewdeck-runner/ ./internal/service/`
- `sh -n apps/runner/install/install.sh` and `shellcheck apps/runner/install/install.sh`
- `pnpm exec nx run runner:dist` then `ls dist/runner/*/`
- `scripts/captures.sh apps/web/e2e/demarrage.spec.ts`
- `pnpm exec nx affected -t lint typecheck test build --base=origin/develop`

## For prod

- `PUBLIC_URL` and `RUNNER_DIST_DIR` in the server's `.env` of staging and production (mirrored in `docs/pilotage/mep.json`).

## Out of scope

- The key exchange and the vault key: E2E-2. Comptes IA and the `ai-accounts` step: RUNNER-7. The `projects` step: PROJET-2.
- `status`, `restart`, `logs`, `uninstall`, self-update: RUNNER-8.

## Dependencies

- RUNNER-2.
- E2E-1.
- UI-3.
