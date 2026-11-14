---
id: RUNNER-19
title: "A Commande's health address: 2xx within 120 s, the process kept as a service of the Runner, stopped before its next run and by uninstall"
epic: RUNNER
type: feature
priority: P1
size: S
milestone: M3 Sessions and preparing Projets
blocked_by: [RUNNER-18]
adr: [0013]
risques: [OPS-11]
stories: [US-104]
screens: []
revue_visuelle: false
video: false
---

## Context

US-104 names a health address: a Commande that starts a local server (`pnpm dev`, `docker compose up`) never exits, so its exit code cannot be its verdict (ADR 0013, « Options that lost »). ADR 0013, « Verdict »: with a health address, the run passes when a `GET` answers 2xx within 120 s of the start (polled every second) and the process has not exited with an error; a process still running is then kept as a service of the Runner (`~/.crewdeck/services/<projectId>/<commandId>.pid`), stopped (SIGTERM, SIGKILL after 10 s) before the same Commande runs again, and by `crewdeck-runner uninstall`. Risk OPS-11: a service left running and occupying the machine. The « Livraison » (PROCESS-13) launches a Local Projet this way.

## Current state of the code

- Created by RUNNER-18: `apps/runner/internal/command/` (`sealed.go` opening `healthUrl` with the text and the place, `place.go`, `run.go` with its process group, the 30 min timeout, `command.stop`, the one-run-per-Commande rule, `log.go`), `command.verdict` and its `reason` enum in `packages/contracts/src/runner/command.ts`.
- `apps/runner/cmd/crewdeck-runner/maintenance.go`: `uninstall` (keys first, then the service, `~/.crewdeck/`, the binary).
- No `~/.crewdeck/services/`.

## To do

- **Contracts**: `command.verdict.reason` gains `healthy` (passed through the address) and `health-timeout`; fixtures; `pnpm exec nx run contracts:generate`.
- **Runner** `apps/runner/internal/command/health.go`: when the opened entry has a `healthUrl`, a `GET` every second from the start (2 s timeout each, no redirect followed beyond 3, no body read past 1 KiB):
  - a 2xx while the process runs → `passed: true`, `healthy`: the process becomes a service;
  - a 2xx after the process exited 0 (a command that daemonizes, `docker compose up -d`) → `passed: true`, `healthy`, no service;
  - the process exits non-zero first → `passed: false`, `exited`, its code;
  - 120 s without a 2xx → the group is killed, `passed: false`, `health-timeout`;
  - the 30 min timeout does not apply to a run with a health address.
- `apps/runner/internal/command/services.go`:
  - a service is the run's process group, recorded in `~/.crewdeck/services/<projectId>/<commandId>.pid` (folder mode 700, file mode 600, written at once): `{ pid, pgid, startedAt, runId }`, `startedAt` the process's start time as the OS reports it (`/proc/<pid>/stat` on Linux and WSL, `ps -o lstart= -p` on macOS), so that a reused pid is never taken for it;
  - after the verdict, the service's output goes on to `~/.crewdeck/services/<projectId>/<commandId>.log` (mode 600, replaced at each start), never relayed: the run's log ends with the line « Service démarré (pid <n>). »;
  - before a `command.run` of the same Projet and Commande: its service, if alive, is stopped (SIGTERM to the group, SIGKILL after 10 s) and its file removed, then the run starts; a stop that fails gives `spawn-failed` and nothing new runs;
  - at the Runner's start: a file whose process is gone (or whose start time differs) is removed; a live one stays tracked;
  - a service that exits by itself: its file is removed when the Runner notices (at the next run, the next start, or its own `Wait` while the Runner lives).
- `crewdeck-runner uninstall`: stops every service (as above) before removing anything else, and says « <n> services arrêtés. » when there were some.
- `docs/pilotage/risques.json`: OPS-11's solution ticked.

## Decisions already made

- A service is the Runner's: no command to list or stop it apart, at the MVP; the next run of its Commande, the Runner's uninstall, or the Pilote's own tools stop it (ADR 0013).
- A Runner restart under systemd or launchd stops its children with it; a service that survives (`crewdeck-runner run` in a terminal then stopped) is found again at start by its file and start time, and stopped before its Commande's next run.
- The service's own output after the verdict stays on the machine in its file: the run's verdict is given, the Session-like output ends there.
- A 3xx is not healthy: the address given is the one that must answer 2xx.

## Acceptance criteria

- [ ] A command that starts a local HTTP server (a test helper) answering 200 after 2 s passes `healthy`, and its pid file exists with its start time; the server still answers after the verdict.
- [ ] Running the same Commande again stops the first server (its port is free, the old pid gone) before the new one starts.
- [ ] A command that exits 0 then lets the address answer passes with no pid file; one that exits 1 fails `exited` with code 1; an address that never answers fails `health-timeout` after 120 s (fake clock), the group killed.
- [ ] A pid file whose pid now belongs to another process (other start time) is removed at start and that process is not signalled.
- [ ] `uninstall` stops a running service before removing `~/.crewdeck/`.

## Verification

- `cd apps/runner && go test ./internal/command/ ./cmd/crewdeck-runner/ -run 'Health|Service|Uninstall'`
- `pnpm exec nx test contracts -- src/runner/`
- `pnpm exec nx run contracts:generate` with no diff, then `pnpm exec nx affected -t lint typecheck test build --base=origin/develop`

## For prod

Nothing.

## Out of scope

- Running a Commande, its timeout and its output: RUNNER-18. The « Livraison » Phase that launches the Projet: PROCESS-13. The page's health address field: PROCESS-12.

## Dependencies

- RUNNER-18.
