---
id: RUNNER-8
title: "Runner maintenance: status, start, restart, logs, uninstall and self-update"
epic: RUNNER
type: feature
priority: P2
size: M
milestone: M2 Runner and Projets
blocked_by: [RUNNER-3]
adr: [0004, 0009]
risques: [IA-3]
stories: [US-2, US-38]
screens: []
revue_visuelle: false
video: false
---

## Context

ADR 0004's command table: `status` (link, server, Moteurs and models usable and why not, US-38), `restart`, `logs` (no Session content), `uninstall` (after a confirmation); and the self-update: a Runner older than the server's protocol window updates itself (download, checksum, replace, restart) before anything else. The `runner-hors-ligne` mockup tells the Pilote to run `crewdeck-runner start`, a command the ADR's table does not list: this ticket adds it.

## Current state of the code

- Created by RUNNER-2: `apps/runner/cmd/crewdeck-runner/` (root, `run`), `internal/protocol/` (with `hello.rejected { reason: 'update-required', latestVersion }` and close code 4426), `internal/state/`.
- Created by RUNNER-3: `link`, `apps/runner/internal/service/` (systemd `--user` unit, launchd plist), `GET /runner/:version/:os-:arch` and `.sha256`, `GET /runner/install.sh`.
- Created by RUNNER-7 if merged: `internal/accounts/` and the capabilities computation (`status` reuses it; without it, `status` lists the Moteurs found on `PATH` only).
- No `status`, `start`, `restart`, `logs`, `uninstall`, no update.

## To do

- `crewdeck-runner status`: prints, in French: « Relié à <server> » or « Pas relié : lance la commande de la page Premiers pas. »; the service's state (active, inactive, not installed); the connection (« en ligne », « le serveur ne répond pas »); the version and whether an update is available (`GET /runner/latest` → `{ version }`, new route); per Moteur: installed version (« version non vérifiée » when unknown), account, each model usable or why. Exit 0, or 1 when not linked. `--json` prints the same as JSON.
- `crewdeck-runner start` / `stop` / `restart`: `systemctl --user start|stop|restart crewdeck-runner` or `launchctl kickstart -k gui/<uid>/com.crewdeck.runner` (start: `bootstrap` if not loaded); without a service (WSL without systemd), `start` says to run `crewdeck-runner run`.
- `crewdeck-runner logs [-f] [-n 200]`: `journalctl --user -u crewdeck-runner` or the launchd log file `~/.crewdeck/runner.log`; the Runner's logger (`log/slog`, JSON) never writes an event's content, a message or a key (a test greps the log of a Session replay for its text).
- `crewdeck-runner uninstall [--yes]`: asks « Supprimer le Runner, ses clones et ~/.crewdeck ? (o/N) », stops and removes the service, deletes `~/.crewdeck/` and the binary, deletes the stored API keys from the keychain; says that the Runner stays listed on the account until a new link replaces it.
- Self-update `apps/runner/internal/update/`: on `hello.rejected { reason: 'update-required' }` (and on `crewdeck-runner update`), download `GET /runner/<latestVersion>/<os>-<arch>` and its `.sha256` from the linked server, verify, write next to the binary, `rename` over it (atomic), restart through the service (or re-exec in the foreground). A failed checksum keeps the old binary and logs `update.checksum-mismatch`. At most one attempt per 10 min.
- Server: `GET /runner/latest` → `{ version }` (the version of the binaries it embeds).

## Decisions already made

- `start` is added to the commands for the mockup's `runner-hors-ligne` banner; `stop` comes with it. ADR 0004's table is completed by this ticket's PR (a line each), no decision changes.
- Updates come only from the server the Runner is linked to, verified by SHA-256 over HTTPS; no other channel.
- The Runner's log is JSON lines, levels info and above by default; `CREWDECK_LOG=debug` adds debug, never content.

## Acceptance criteria

- [ ] `status` prints link, service, connection, version and each Moteur's models with reasons; `--json` matches a Go struct test; exit 1 when not linked.
- [ ] `start`, `stop`, `restart` call the right service manager (fake `systemctl`/`launchctl` on `PATH` in tests).
- [ ] `uninstall` asks first, then removes the service, `~/.crewdeck/`, the keys and the binary (in a temp `CREWDECK_HOME` and fake keyring).
- [ ] A Runner rejected with `update-required` downloads, verifies and replaces itself, then reconnects with the new version (integration test with an `httptest` server serving two builds); a bad checksum keeps the old binary.
- [ ] The log of a replayed Session contains no message text.

## Verification

- `cd apps/runner && go test ./cmd/crewdeck-runner/ ./internal/update/ ./internal/service/`
- `pnpm exec nx test server -- src/runners/`
- `pnpm exec nx affected -t lint typecheck test build --base=origin/develop`

## For prod

Nothing.

## Out of scope

- The page's « Runner hors ligne » Banner: ATOI-3.
- The nightly smoke test of the compiled binary: RUNNER-14.

## Dependencies

- RUNNER-3.
