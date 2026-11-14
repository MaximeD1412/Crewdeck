---
id: RUNNER-16
title: "Serveurs MCP declared on the Runner: crewdeck-runner mcp add|list|remove|test, their secrets on the machine, their names on the « Runner » page"
epic: RUNNER
type: feature
priority: P0
size: M
milestone: M3 Sessions and preparing Projets
blocked_by: []
adr: [0013, 0004]
risques: [SEC-13]
stories: [US-73]
screens: [runner-serveurs-mcp]
revue_visuelle: true
video: false
---

## Context

US-73: the Pilote declares Serveurs MCP on their Runner, their secrets staying there, and attaches them to the Étapes whose agents may use them. ADR 0013, « A Serveur MCP »: a Serveur MCP is declared on the Runner like a Compte IA (`crewdeck-runner mcp add|list|remove|test`), its configuration in `~/.crewdeck/mcp.json` (mode 600), its `--env` and `--header` values in the OS keychain when there is one; the server knows only the names, which the Runner reports as `mcp.servers` after `hello` and on each change, and the « Runner » page lists them. This ticket is the declaration and the report; mounting them in a Session is RUNNER-17, attaching one to an Étape (« Attacher un Outil ») PROCESS-9, the Projet's preparation pointing at a name the Runner does not declare PROJET-3.

## Current state of the code

- `apps/runner/cmd/crewdeck-runner/claude.go`: `newMCPCommand()`, the hidden `crewdeck-runner mcp` with its one subcommand `permission` (the permission server Claude runs for a Session, `permission.ServerName = "crewdeck"` in `apps/runner/internal/engine/claude/permission/permission.go`), registered in `main.go`.
- `apps/runner/internal/accounts/accounts.go`: `Keyring` (interface), the OS keychain through `github.com/zalando/go-keyring` (service `crewdeck-runner`), the fallback file in `~/.crewdeck/secrets/` (mode 600) and the keychain marker; `accounts/refresh.go`: `runner.sock`, the request `login` and `logout` send to the running Runner so that it reports again; `cmd/crewdeck-runner/run.go` serves it (`accounts.Serve`) and reports on each accepted connection (`OnConnected`).
- `apps/runner/cmd/crewdeck-runner/maintenance.go`: `uninstall` removes the API keys from the keychain, then `~/.crewdeck/`.
- `packages/contracts/src/runner/protocol.ts`: `zRunnerToServer` (hello, heartbeat, capabilities, step.verdict); `apps/server/src/runners/ai-accounts/ai-accounts.ts`: the `capabilities` handler (`RunnerDispatcher.registerRunnerHandler`), one row per Moteur upserted with `ai-account.upserted` in one transaction, `GET /api/ai-accounts`, the `ai-account` slice of `/api/state` — the model to imitate.
- `packages/contracts/src/composants/page-runner.ts` (`PageRunner`, version 1: `engines`, `command`, `runner`, Emplacement `usage`), `packages/skin-passerelle/src/page-runner.ts`, `apps/web/src/views/runner.ts` (`runnerView`), keys `runner.*` of `packages/sdk/src/i18n/fr.ts`; scenarios `runner`, `runner-hors-ligne` in `apps/server/src/testing/scenarios/runner.ts`; `apps/web/e2e/runner.spec.ts`.
- No `internal/mcp/`, no `mcp_servers` table, no `mcp-server` event resource.

## To do

- **Runner** `apps/runner/internal/mcp/`:
  - `store.go`: `~/.crewdeck/mcp.json` (mode 600, written at once as `state` writes `runner.json`): `{ "version": 1, "servers": { "<nom>": { "transport": "stdio", "command", "args": [], "env": { "<K>": <secret ref> } } | { "transport": "http", "url", "headers": { "<K>": <secret ref> } }, "state": "ready" | "failed", "toolCount": n | null, "testedAt" } }`; a secret ref is `{ "keychain": true }` (the value under the keychain user `mcp:<nom>:env:<K>` or `mcp:<nom>:header:<K>`) or `{ "value": "…" }` when no keychain answers (the same rule and marker as `accounts.Store`, reusing its `Keyring` interface). `Load`, `Add`, `Remove` (its keychain entries first), `Resolve(name) (Server, error)` giving the values (for `test` and RUNNER-17), `Names()`.
  - `client.go`: a minimal MCP client, `ListTools(ctx, server) ([]Tool{ Name }, error)`: `initialize`, `notifications/initialized`, `tools/list` (following `nextCursor`); stdio by starting the command with its env (its stderr kept, 4 KiB tail, for the error), streamable HTTP by `POST` with `Accept: application/json, text/event-stream`, the headers given, `Mcp-Session-Id` kept between requests, a `text/event-stream` answer read to its JSON-RPC response. 30 s for the whole exchange; the process is killed (its group) at the end.
- **CLI** `apps/runner/cmd/crewdeck-runner/mcp.go` (the visible `crewdeck-runner mcp`, `permission` staying a hidden subcommand beside the new ones):
  - `mcp add <nom> [--env K=V]… -- <commande> [args…]` (stdio) and `mcp add <nom> --url <url> [--header 'K: V']…` (HTTP): saves, then tests; prints « Serveur MCP <nom> déclaré : <n> outils. », or « Serveur MCP <nom> déclaré, mais le test a échoué : <raison> » and exits 1 (the declaration stays, `failed`).
  - `mcp list [--json]`: one line per server, « <nom>  stdio|http  <n> outils|en échec », never a secret (values shown as `***`); `--json` `[{ name, transport, state, toolCount }]`.
  - `mcp remove <nom>`: « Serveur MCP <nom> retiré. »; unknown name: exit 1, « <nom> n'est pas déclaré sur ce Runner. »
  - `mcp test <nom>`: lists its tools (one name per line), updates `state`, `toolCount`, `testedAt`; failure exits 1 with the reason.
  - Names match `^[a-z0-9-]{1,40}$` (else exit 2, « Un nom de Serveur MCP s'écrit en minuscules, chiffres et tirets, 40 caractères au plus. »); `crewdeck` is refused (the permission server's name); an existing name is refused by `add` (« <nom> est déjà déclaré : crewdeck-runner mcp remove <nom> d'abord. »); `--env` without `=`, `--header` without `:`, `--url` not `http(s)://`, both `--url` and a command, or neither: exit 2.
  - After `add`, `remove` and `test`, the command asks the running Runner to report again through `runner.sock`, the request `login` sends; no Runner running: nothing else, the next connection reports.
- **Report**: `packages/contracts/src/runner/mcp.ts`, Runner → server `mcp.servers { servers: [{ name, transport: 'stdio'|'http', state: 'ready'|'failed', toolCount: int|null }] }` (max 100, names by the regex above), in `zRunnerToServer`, fixture `packages/contracts/fixtures/runner/mcp.servers.json`; `pnpm exec nx run contracts:generate`. The Runner sends it on each accepted connection (beside `capabilities`) and on each refresh request of `runner.sock`; never a command, an argument, a URL, a header nor an env value.
- `uninstall` (`maintenance.go`): removes the Serveurs MCP's keychain entries with the API keys, before anything else (a keychain that refuses leaves the Runner whole, as for the keys).
- **Server** `apps/server/src/runners/mcp-servers/` (beside `ai-accounts/`):
  - Prisma `McpServer` (`mcp_servers`): `id` (UUIDv7), `pilotId`, `name`, `transport` (`stdio|http`), `state` (`ready|failed`), `toolCount Int?`, `reportedAt`; unique (`pilotId`, `name`); one migration.
  - The `mcp.servers` handler: in one transaction, the reported set replaces the Pilote's rows (upsert each, delete the absent), `mcp-server.upserted` per changed row and `mcp-server.removed` per deleted one.
  - Contracts `packages/contracts/src/api/mcp-servers.ts`: `zMcpServer { id, name, transport, state, toolCount, reportedAt }`, `zMcpServerList { items }`; resource `mcp-server` in `RESOURCES` (`packages/contracts/src/events/index.ts`) and its payload registered.
  - `GET /api/mcp-servers` (ordered by name), `StateContributor` key `mcp-server`.
- **Web**: store slice `mcp-server` (`apps/web/src/store/`) applying both events; `runnerView` gains `mcpServers`.
- **Composant**: `PageRunner` version 2, data `mcpServers: [{ name, transport, state, toolCount }]`, examples « en ligne » with two servers and « aucun Serveur MCP »; `packages/skin-passerelle/src/page-runner.ts` draws, first in the main column, the card « Serveurs MCP » (count; a row per server: icon `layers`, title its name, meta « stdio · <n> outils » or « HTTP · <n> outils », badge « déclaré » `go` when `ready`, « en échec » `halt` when `failed`; none: « Aucun Serveur MCP déclaré. ») and the card « Déclarer un Serveur MCP » (« Sur ta machine, jamais ici : ses secrets restent sur le Runner. Il s'attache ensuite aux Étapes, dans la Gestion du process de chaque Projet. » and the code block `crewdeck-runner mcp add <nom> -- <commande>`); keys `runner.mcp.*` in `packages/sdk/src/i18n/fr.ts`.
- **Scenario** `runner-serveurs-mcp` (`apps/server/src/testing/scenarios/runner.ts`, registered in `index.ts`): the `runner` scenario plus two servers (`stitch` stdio 12 outils `ready`, `figma` HTTP 4 outils `ready`); the e2e `apps/web/e2e/runner.spec.ts` gains it, and a server arriving from the fake Runner's `mcp.servers` appearing without reload.

## Decisions already made

- Mockup: `runner-serveurs-mcp` (page `design/screens/crewdeck/runner-serveurs-mcp.html`; captures `design/screens/crewdeck/runner-serveurs-mcp-390.png`, `…-1280.png`). It gives the look, this ticket the scope: an element of the mockup absent from this ticket is not built, its filler text is not copied, and the screen is composed with the design system's components (`design/DESIGN.md`); the page's HTML and CSS are a reference, not code to copy.
- The two cards show in every state of the page, first in the main column, as in `runner-serveurs-mcp` (the older `runner` mockup predates them); the Runner offline leaves the list as last reported.
- The mockup's meta « attaché à « Maquettes » · Site mairie, Personal OS » needs the attachments, which come with PROCESS-9: here the meta is the transport and the tool count.
- `add` always tests, and keeps a declaration whose test failed (`failed`): a server that needs a login or a network the machine has later can still be declared; exit 1 says it.
- The Runner does not start the Serveurs MCP to report them: `state` and `toolCount` are the last `add` or `test`'s, so `hello` starts nothing of the Pilote's.
- Refreshing through the `runner.sock` request of `login` keeps this ticket independent of MIROIR-6's socket ops; a request without `op` stays the refresh.
- Secrets never leave the machine: not in `mcp.servers`, a log, an error, `mcp list` nor a test's golden (ADR 0013, risk SEC-13).

## Acceptance criteria

- [ ] `mcp add stitch --env API_KEY=s3cr3t -- npx stitch-mcp` against a fake stdio server (the test binary re-executed as an MCP server) saves `mcp.json` mode 600 with `{ "keychain": true }` for `API_KEY`, the value in the fake keychain, and prints the tool count; with a keychain that fails, the value is in the file and nowhere else.
- [ ] `mcp add figma --url <httptest URL> --header 'Authorization: Bearer x'` lists the tools of a fake streamable HTTP server (JSON and SSE answers both), the header received by it.
- [ ] A server whose test fails is declared `failed`, the command exits 1 with its reason; `mcp test` on it after the fake is fixed makes it `ready`.
- [ ] Bad names (`Stitch`, 41 characters, `crewdeck`), a duplicate name, `--env` without `=` are refused with their messages and exit codes; `mcp remove` deletes the keychain entries.
- [ ] After `add`, the running Runner sends `mcp.servers` (fake server); the message holds names, transports, states and counts only (asserted: no env value, URL nor header in it, nor in the Runner's log).
- [ ] The server's handler replaces the set in one transaction with its events: a server removed on the Runner disappears from `GET /api/mcp-servers` and from an open tab without reload.
- [ ] `GET /api/mcp-servers` follows ADR 0008's route baseline (schema, 401, another Pilote's rows never listed).
- [ ] `PageRunner` renders both cards for each example, the empty state included (Composant test), and `/parametres/composants` shows version 2.
- [ ] `uninstall` removes the Serveurs MCP's keychain entries; a keychain that refuses stops it before anything is removed.
- [ ] The fixture of `mcp.servers` is valid in TypeScript and Go.

## Verification

- `cd apps/runner && go test ./internal/mcp/ ./cmd/crewdeck-runner/ -run 'MCP|Uninstall'`
- `pnpm exec nx test contracts -- src/runner/ src/composants/`
- `pnpm exec nx test server -- src/runners/mcp-servers/`
- `pnpm exec nx test-integration server -- mcp-servers`
- `pnpm exec nx test skin-passerelle -- src/page-runner.spec.ts`, `pnpm exec nx test web -- src/views/runner.spec.ts`
- `pnpm exec nx e2e web -- runner.spec.ts`
- `scripts/captures.sh runner-serveurs-mcp`
- `pnpm exec nx run contracts:generate` with no diff, then `pnpm exec nx affected -t lint typecheck test build --base=origin/develop`

## For prod

A migration (table `mcp_servers`). Mirrored in `docs/pilotage/mep.json`.

## Out of scope

- Mounting the servers in a Session (Claude `--mcp-config`, Codex `config.toml`): RUNNER-17.
- « Attacher un Outil » with a Serveur MCP, and the « attaché à » meta of the list: PROCESS-9.
- A name the Process attaches that the Runner does not declare, shown in the Projet's preparation: PROJET-3.

## Dependencies

None.
