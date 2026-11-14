# The Runner: a Go binary that drives the official agent programs

> **Status:** accepted, 2026-11-10. Amended by [ADR 0010](0010-the-runners-miroir.md)
> on the Runner's state (`miroir.db`), protocol (the Miroir's replay) and
> commands (`crewdeck-runner miroir`). Amended by [ADR 0011](0011-the-process-as-data.md)
> (no more `.process.json`: the worktree's Commandes are Paramètres),
> [ADR 0012](0012-sources-local-and-github.md) (the Local folder as the
> clone's `origin`) and [ADR 0013](0013-commandes-and-serveurs-mcp.md)
> (Commandes, Serveurs MCP).

## Context

Agents run on the **Pilote**'s machine, on the official programs they sign
in to themselves, with their own **Comptes IA**; the product never holds an
AI credential (PRD, « Principles »). The providers' terms
(`docs/research/2026-11-08-ai-providers-and-competitors.md`) forbid a
third-party product to route a subscription through the Agent SDK, and
allow the unmodified Claude Code binary signed in by the user; Codex's
ChatGPT sign-in is for selected partners only. The dotfiles console drives
Claude through the Agent SDK on the founder's subscription: fine for
personal use, not shippable.

## Decision

### Packaging and lifecycle

- Go (the version in `.mise.toml`), static binaries for linux and darwin,
  amd64 and arm64 (Windows through WSL, US-2). Built by CI and embedded in
  the server's image of the same commit, which serves them:
  `GET /runner/install.sh`, `GET /runner/<version>/<os>-<arch>` and its
  `.sha256`.
- Install: `curl -fsSL https://<domain>/runner/install.sh | sh -s -- --link
  <code>` puts `crewdeck-runner` in `~/.local/bin`, links it
  ([ADR 0003](0003-privacy-and-end-to-end-encryption.md) for the code) and
  installs a user service (systemd `--user` on Linux and WSL, launchd on
  macOS; without systemd on WSL, the installer says how to enable it and
  `crewdeck-runner run` works in the foreground).
- State in `~/.crewdeck/` (`runner.json`, its key, `repos/`, `worktrees/`,
  `sessions/`), mode 700.
- **Protocol**: one WebSocket to the server ([ADR 0007](0007-real-time.md)),
  messages from `packages/contracts/src/runner/`. The server accepts the
  Runner protocol of its own version and the one before; a Runner older than
  that updates itself (download, checksum, replace, restart) before
  anything else. `--server <url>` links a Runner to staging.
- **Presence**: a heartbeat every 15 s; the server marks the Runner « hors
  ligne » after 45 s without one.
- **One Runner per Pilote** (glossary). Linking a new one revokes the old
  (its token and its public key).

### Commands

| Command | What |
|---|---|
| `crewdeck-runner link <code>` | Links this machine to the account (the installer runs it) |
| `crewdeck-runner login claude\|codex` | Connects a **Compte IA**: runs the Moteur's own sign-in (`claude` then `/login`, `codex login`) or asks for an API key, stored in the OS keychain when there is one, else a file of mode 600 |
| `crewdeck-runner status [--json]` | Link, service, connection, version and update available, Moteurs and models usable and why not (US-38); exit 1 when not linked |
| `crewdeck-runner start` / `stop` / `restart` | Starts, stops, restarts the service (`systemctl --user`, `launchctl`) |
| `crewdeck-runner update` | Updates the binary to the version of the server it is linked to (`GET /runner/latest`), checksum verified, then restarts the service |
| `crewdeck-runner appareils approuver <code>` | Trusts an **Appareil** from the machine |
| `crewdeck-runner logs [-f] [-n 200]` | The service's log, `journalctl` or `~/.crewdeck/runner.log` (no Session content) |
| `crewdeck-runner uninstall [--yes]` | Removes the service, the binary, `~/.crewdeck/` and the API keys of the keychain after a confirmation |

A failed link says why and prints the command again (US-2): code expired,
code already used, server unreachable, system not supported, no **Moteur**
found on the machine.

### Moteurs

One adapter per **Moteur** (`apps/runner/internal/engine/<moteur>/`)
behind one interface: start, send a message, answer a request, interrupt,
resume, list models, report usage. Each declares its capabilities; the
events are normalised in `packages/contracts/src/runner/events.ts`, the
provider's raw event kept beside them.

- **Claude Code**: the unmodified `claude` binary, `-p --input-format
  stream-json --output-format stream-json --verbose`, `--model`,
  `--resume`; permission requests through `--permission-prompt-tool` on an
  MCP server the Runner serves to the Session; `AskUserQuestion` held by a
  `PreToolUse` hook and answered through the same channel. Compte IA: the
  Pilote's own sign-in to the binary, or an API key. No Agent SDK.
- **Codex**: `codex app-server` for the Sessions the Pilote drives (Rôles
  Idée and Conception), `codex exec --json` for the Boucle (Code, Review).
  Compte IA: an API key at the MVP; a ChatGPT plan only through « Sign in
  with ChatGPT », once OpenAI grants it.
- **Usage** (US-55): what each Moteur reports (limit windows and their reset
  for a subscription, cost for an API key) goes to the server as figures,
  never content.
- **The spike comes first** (the first ticket of the Runner): on the
  founder's machine, a permission request that waits for hours, a Skill's
  `AskUserQuestion`, interrupt then resume, the limit and usage events of
  both Moteurs, Codex's approval requests, a Session that survives a Runner
  restart through `--resume`. One failure reopens the PRD. Its findings and
  the recorded streams go to `docs/spikes/engines.md` and
  `apps/runner/internal/engine/<moteur>/testdata/`.

### Where agents work

- The Runner's own clones (`~/.crewdeck/repos/github/<owner>/<repo>`, and
  `repos/local/<projectId>` for a Local Projet, [ADR 0012](0012-sources-local-and-github.md)), one
  worktree per Session (`~/.crewdeck/worktrees/<projet>/<branch>`); never
  the Pilote's checkout.
- The Projet's Commandes « Préparer le worktree » and « Nettoyer le
  worktree » (its Paramètres, sealed, [ADR 0013](0013-commandes-and-serveurs-mcp.md))
  prepare and clean a worktree, as `agent-loop`'s `setupCmd` and `dropCmd` do.
- **Permissions**: the Rôles Code and Review run without prompts inside
  their worktree (`--permission-mode bypassPermissions`, Codex's full-auto
  equivalent), as `agent-loop` does today; the Sessions the Pilote drives run
  in `auto`, their requests going to the Pilote. A container per Session
  comes with the Runner on a server (US-70, Bêta). Risk AGT-1.

### Official Skills

- The **Skills** of each **Étape** ship inside the Runner's release
  (`apps/runner/skills/<skill>/SKILL.md`, embedded with `go:embed`),
  derived from the dotfiles skills: the `design`, `ideas` and `agent-loop`
  commands they call become `crewdeck-runner etape <verb>` (start, report,
  ask), which talk to the server.
- Mounted per Session: Claude through `--plugin-dir` on a plugin the Runner
  writes from the embedded files; Codex through the skills folder of a
  `CODEX_HOME` the Runner prepares for the Session. A Skill and the checker
  of its **Contrat** always share the Runner's version.

## Options that lost

- **The Agent SDK** (the console's): the only shippable use is with an API
  key, and the subscription path would need a second integration anyway.
- **An npm package**: Node on every machine, which Claude Code and Codex no
  longer need.
- **Working in the Pilote's checkout**: their uncommitted work under the
  agents' feet.
- **Skills downloaded at each Session**: a Skill could run against a checker
  of another version.

## Consequences

- Tests never run a real Moteur: each adapter replays the recorded streams
  of `testdata/` through a fake binary (`internal/engine/fake/`), and the
  protocol tests run against a fake server (`httptest`).
- The first files to imitate: `apps/runner/internal/engine/claude/` (an
  adapter), `apps/runner/internal/session/` (a Session's lifecycle),
  `apps/runner/cmd/crewdeck-runner/` (a command).
