# Commandes and Serveurs MCP run on the Runner, with the Pilote's own secrets

> **Status:** accepted, 2026-11-14. Amends [ADR 0004](0004-the-runner.md)
> (the Runner runs Commandes and keeps the Pilote's Serveurs MCP; new
> commands `crewdeck-runner mcp`).

## Context

An agent reaches any tool, even one with no Connecteur
([feature PRD](../product/features/gestion-du-process.md)): a Serveur MCP
gives tools to the agents of the Étapes it is attached to (US-73), a
Commande runs on the Runner's machine to check or launch (US-104 to
US-106). Their secrets never leave the machine (PRD, « Constraints »), and
the product never reads through them, so neither can be a Source. The
Runner ran nothing but the Moteurs on 2026-11-13, and the Claude adapter's
only MCP server was its own permission server.

## Decision

### A Commande

- **Its text is sealed** in the Process's version
  ([ADR 0011](0011-the-process-as-data.md)): the server sends `command.run
  { runId, projectId, commandId, sealed, where, ref }`; the Runner opens the
  sealed part, checks that it names this Projet and this `commandId`, and
  runs only what it opened.
- **Where**: `worktree` is the Ticket's worktree at the SHA under judgement;
  `project` is the Projet's folder when it has one, else the Runner's
  checkout of the integration branch (`~/.crewdeck/worktrees/<projet>/integration`),
  moved to the merged SHA before each run.
- **How**: `$SHELL -lc '<text>'` (`/bin/sh -lc` when `SHELL` is unset), so
  the Pilote's login environment applies; plus `CREWDECK_PROJECT`,
  `CREWDECK_STEP`, `CREWDECK_TICKET`, `CREWDECK_BRANCH`, `CREWDECK_SHA`. Its
  secrets are the Pilote's own (their environment, the folder's `.env`): the
  Runner keeps none. It runs as the Pilote, in its own process group, one
  run per Projet and Commande at a time.
- **Verdict**:
  - with no health address: exit code 0 passes, any other fails; after
    30 min the group is killed and the run fails as `command.timeout`;
  - with a health address: the run passes when a `GET` answers 2xx within
    120 s of the start (polled every second) and the process has not
    exited with an error. A process still running is then kept as a
    service of the Runner (`~/.crewdeck/services/<projectId>/<commandId>.pid`),
    stopped (SIGTERM, SIGKILL after 10 s) before the same Commande runs
    again, and by `crewdeck-runner uninstall`.
- **Output** streams like a Session's: encrypted for the tabs that open
  it, relayed, never stored by the server
  ([ADR 0003](0003-privacy-and-end-to-end-encryption.md)); the Runner keeps
  it in `~/.crewdeck/commands/<runId>.log` for 30 days. The verdict
  (`command.verdict { runId, passed, exitCode, reason }`) carries figures
  only.
- **In the Process**: a `command` Étape that fails raises `command.failed`
  (« Relancer », « Arrêter »), the « Livraison » one included (US-105); the
  `checks` Étape runs its Commandes in the worktree and gives one Verdict,
  failed if one fails, which the Merge never passes and the Review reads;
  « Préparer le worktree » and « Nettoyer le worktree » (the Projet's
  Paramètres) run around each Session's worktree, a failed preparation
  failing the Étape.

### A Serveur MCP

- **Declared on the Runner**, like a Compte IA:
  - `crewdeck-runner mcp add <nom> [--env K=V]… -- <commande> [args…]`
    (stdio);
  - `crewdeck-runner mcp add <nom> --url <url> [--header 'K: V']…` (HTTP);
  - `crewdeck-runner mcp list`, `mcp remove <nom>`, `mcp test <nom>` (starts
    it, lists its tools).

  Names match `[a-z0-9-]{1,40}`. The configuration is in
  `~/.crewdeck/mcp.json` (mode 600); `--env` and `--header` values are in the
  OS keychain when there is one, else in that file.
- **The server knows the names**: the Runner reports `mcp.servers { servers:
  [{ name, transport, state, toolCount }] }` after `hello` and on each
  change; the « Runner » page lists them, and « Attacher un Outil » with none
  declared points there. An Étape names a server it attaches; a name the
  Runner does not declare is a point of the Projet's preparation (US-4),
  not a Manque.
- **Mounted per Session**, only the servers attached to its Étape: Claude
  through `--mcp-config` (beside the Runner's permission server,
  `--strict-mcp-config` kept), Codex through `[mcp_servers.<nom>]` in the
  Session's `CODEX_HOME/config.toml`. The files holding secrets are mode 600
  in the Session's folder and deleted when it ends. A tool call goes through
  the Session's permission mode ([ADR 0004](0004-the-runner.md)).

## Options that lost

- **Exit code only**: `pnpm dev` never exits, and US-104 names the health
  address.
- **Secrets declared on the Runner for the Commandes**
  (`crewdeck-runner secret set`): a vault to write for what the Pilote's
  shell already has.
- **Serveurs MCP declared in the page**, their secrets typed in the
  browser: secrets that leave the machine, against the PRD's constraint.

## Consequences

- The Runner protocol gets `command.run`, `command.verdict`,
  `command.output` (relayed), `mcp.servers`; the server gets
  `command_runs` (state and figures) and `mcp_servers` (names and states);
  Décisions `command.failed`, `command.timeout`.
- Tests run Commandes in a temporary folder (`sh -c` with an exit code, a
  local HTTP server for the health address) and the MCP mount against the
  recorded streams of each adapter; no test starts a real Serveur MCP.
- The first files to imitate: `apps/runner/internal/command/` (a run and
  its verdict), `apps/runner/internal/mcp/` (the declarations and their
  mount).
