---
id: RUNNER-20
title: "« Préparer le worktree » and « Nettoyer le worktree »: the Projet's sealed Commandes run around each worktree the Runner makes, a failed preparation failing the Étape"
epic: RUNNER
type: feature
priority: P1
size: S
milestone: M3 Sessions and preparing Projets
blocked_by: [RUNNER-18, PARAM-3]
adr: [0013, 0011, 0004]
risques: []
stories: [US-104]
screens: []
revue_visuelle: false
video: false
---

## Context

ADR 0011, « No more `.process.json` »: the worktree's preparation and cleaning, `agentLoop.setupCmd` and `dropCmd` until now, are the Projet's two Commandes « Préparer le worktree » and « Nettoyer le worktree » in its Paramètres, sealed like any Commande. ADR 0013: they run around each Session's worktree, a failed preparation failing the Étape. A fresh worktree of a Node Projet has no `node_modules`: without its preparation, the Code Session and the `checks` Commandes (US-104, BOUCLE-9) fail for a reason that is not the Ticket's. This ticket runs them on the Runner; their text is typed and sealed in the Projet's Paramètres by PARAM-3.

## Current state of the code

- Created by RUNNER-9: the Session's worktree `~/.crewdeck/worktrees/<projectId>/<branch>` made before the Moteur starts and removed when the Session ends (kept when it is stopped or interrupted, for the resume); `apps/runner/internal/session/hooks.go`: `Hooks { Prepare func(ctx, Worktree) error; Clean func(ctx, Worktree) error }`, nil in RUNNER-9, `Prepare` after the worktree is made and before the Moteur (its error ends the Session `setup-failed`), `Clean` before `git worktree remove` (its error logged, the worktree removed anyway); `session.start`, `session.state` with `error: 'setup-failed'` (`packages/contracts/src/runner/session.ts`); `SessionsService.start` (`apps/server/src/sessions/`); no `.process.json` read anywhere.
- Created by RUNNER-18: `apps/runner/internal/command/` (`run.go`: `$SHELL -lc`, the `CREWDECK_*` variables, the process group, kill of the group; `sealed.go` opening with the vault), `command.run` with `ref` and `origin`, `CommandRuns.send` (`apps/server/src/commands/`), the Ticket's worktree used by a `where: worktree` run and removed after it as a Session's is.
- Created by PARAM-3: the Projet's Paramètres (`ProjectSettings`, `apps/server/src/settings/`), with the two worktree Commandes sealed by the page under the vault key, additional data `settings:<projectId>`, their plaintext schema `zWorktreeCommands` (`{ prepare: string|null, clean: string|null }`) in `packages/contracts/src/api/project-settings.ts`.
- `apps/runner/cmd/crewdeck-runner/vault.go`: `openVault`.

## To do

- **Protocol**: `session.start` and `command.run` gain `worktreeCommands: zSealedItem { key, ciphertext } | null`; `command.verdict.reason` gains `setup-failed`; fixtures; `pnpm exec nx run contracts:generate`.
- **Server**: `SessionsService.start` and `CommandRuns.send` put the Projet's sealed worktree Commandes from `ProjectSettings` as they are stored (null when the Pilote set neither); the server never opens them.
- **Runner** `apps/runner/internal/command/worktree.go`, the implementation of RUNNER-9's `Hooks` given to the Session manager and to RUNNER-18's worktree place, so it runs for every worktree the Runner creates or removes for a Session or a `where: worktree` run:
  - open `worktreeCommands` with the vault, additional data `settings:<projectId>` of the message's `projectId`, plaintext `zWorktreeCommands`;
  - **prepare**: right after `git worktree add` and before the Moteur starts (or before the run's own command), `prepare` runs in the worktree as a Commande runs (`$SHELL -lc`, the `CREWDECK_*` variables, its own process group), 15 min at most; its output to `~/.crewdeck/sessions/<sessionId>/prepare.log` (mode 600) for a Session, appended to the run's log (RUNNER-18) for a run;
  - a preparation that exits non-zero, times out, or a sealed part that does not open: the worktree is removed (with `clean` if it opens), the Session ends `ended` / `outcome: 'error'` / `error: 'setup-failed'` and its local log gets one normalised `error` event (`code: 'setup-failed'`, the message « Préparer le worktree a échoué (code <n>) » and the last 50 lines of its output), so that the Session's panel (SESSION-2) shows why through the relay; a run gives `passed: false` with `reason: 'setup-failed'` (added to `command.verdict.reason`);
  - **clean**: before `git worktree remove`, `clean` runs in it (10 min at most, output appended to the same log); its failure is logged on the Runner's log (exit code only) and the worktree is removed anyway;
  - a worktree kept (a stopped or interrupted Session, a resume) is not prepared again; a later Session or run that recreates it prepares it again.

## Decisions already made

- « Each Session's worktree » covers the Ticket's worktree a `where: worktree` Commande uses (RUNNER-18): it is the same worktree, and a `checks` Commande needs it prepared as much as the Code Session does.
- The preparation's failure fails the Étape (ADR 0013): its StepRun fails through the Session's `setup-failed` (RUNNER-12, BOUCLE-3) or the run's verdict (PROCESS-12, BOUCLE-9); the Runner raises no Décision of its own.
- Cleaning never fails anything: a worktree left half-cleaned is still removed, so the next Session starts fresh.
- Both texts are opened on the Runner only, like any Commande (ADR 0011): the server keeps them opaque, and a text that does not open is never run.
- 15 and 10 min, the bounds `agent-loop`'s `setupCmd` had, so that a stuck install fails the Étape instead of holding the Ticket.

## Acceptance criteria

- [ ] A Session on a Projet whose `prepare` writes a marker file: the marker exists in the worktree before the fake Engine starts, `prepare.log` holds its output.
- [ ] `prepare` exiting 2: the Session ends with `setup-failed`, its log holds the `error` event with the exit code and the output's tail, the fake Engine never started, the worktree is gone.
- [ ] `clean` runs before the worktree is removed at the Session's end; `clean` exiting 1 is logged and the worktree is removed anyway.
- [ ] A stopped Session resumed: `prepare` does not run again.
- [ ] A `where: worktree` run on an absent worktree runs `prepare` first; a failed `prepare` gives `setup-failed` and the command does not run.
- [ ] `worktreeCommands` sealed for another Projet does not open: `setup-failed`, nothing runs. `worktreeCommands: null`: the worktree is made and removed as before.
- [ ] The fixtures of `session.start` and `command.run` with `worktreeCommands` are valid in TypeScript and Go.

## Verification

- `cd apps/runner && go test ./internal/command/ ./internal/session/ -run 'Worktree|Prepare|Clean'`
- `pnpm exec nx test contracts -- src/runner/`, `pnpm exec nx test server -- src/sessions/ src/commands/`
- `pnpm exec nx run contracts:generate` with no diff, then `pnpm exec nx affected -t lint typecheck test build --base=origin/develop`

## For prod

Nothing.

## Out of scope

- Typing and sealing the two Commandes in the Projet's Paramètres: PARAM-3.
- Running a Commande Étape and its verdict: RUNNER-18, PROCESS-12.

## Dependencies

- RUNNER-18.
- PARAM-3.
