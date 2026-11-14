---
id: RUNNER-17
title: "Serveurs MCP mounted per Session: only those of its Étape, Claude through --mcp-config, Codex through its CODEX_HOME, secret files deleted at the end"
epic: RUNNER
type: feature
priority: P1
size: S
milestone: M3 Sessions and preparing Projets
blocked_by: [RUNNER-16, RUNNER-9, RUNNER-6]
adr: [0013, 0004]
risques: [SEC-13]
stories: [US-73]
screens: []
revue_visuelle: false
video: false
---

## Context

US-73: each agent gets the tools its Étape needs, and nothing more. ADR 0013, « Mounted per Session »: only the Serveurs MCP attached to the Session's Étape are mounted, Claude through `--mcp-config` beside the Runner's permission server (`--strict-mcp-config` kept), Codex through `[mcp_servers.<nom>]` in the Session's `CODEX_HOME/config.toml`; the files holding secrets are mode 600 in the Session's folder and deleted when it ends; a tool call goes through the Session's permission mode (ADR 0004). Risk SEC-13: a Serveur MCP must never reach the agents of an Étape it is not attached to.

## Current state of the code

- `apps/runner/internal/engine/engine.go`: `StartOptions { Dir, Model, Role, PermissionMode, Env, SkillsDir, InitialPrompt, SessionDir, BinaryPath }`, `ResumeOptions`.
- `apps/runner/internal/engine/claude/claude.go`: `sessionFiles.writeConfig` writes `<SessionDir>/claude/mcp.json` (mode 600) with the permission server only (`permission.ServerName = "crewdeck"`, `crewdeck-runner mcp permission --session … --control …`) and `settings.json`; `start` passes `--strict-mcp-config`, `--mcp-config <that file>`, `--permission-prompt-tool`; the files are written at each `Start` and `Resume`.
- Created by RUNNER-16: `apps/runner/internal/mcp/` (`mcp.json`, `Store.Resolve(name)` giving a server with its secret values, `Names()`), `crewdeck-runner mcp add|list|remove|test`, `mcp.servers`.
- Created by RUNNER-9: `session.start` (`packages/contracts/src/runner/session.ts`), `SessionsService.start` (`apps/server/src/sessions/`), the Session's manager and folder `~/.crewdeck/sessions/<id>/` (`apps/runner/internal/session/`).
- Created by RUNNER-6: `apps/runner/internal/engine/codex/` (`app-server` and `exec`, `CODEX_HOME` per Session, never `~/.codex`).

## To do

- **Protocol**: `session.start` gains `mcpServers: string[]` (names, `^[a-z0-9-]{1,40}$`, max 20, default `[]`); fixture updated; `pnpm exec nx run contracts:generate`.
- **Server**: `SessionsService.start` takes `mcpServers?: string[]` and sends them as given (the caller passes the Étape's `{ kind: 'mcp', name }` Outils); the names are configuration the server reads (ADR 0011), nothing else about a server travels.
- **Engine**: `StartOptions.MCPServers []engine.MCPServer` (`Name`, `Transport` stdio|http, `Command`, `Args`, `Env map[string]string`, `URL`, `Headers map[string]string`), neutral, filled by the Session from `mcp.Store.Resolve`.
- **Session** (`apps/runner/internal/session/`): on `session.start` and `session.resume`, resolves each name of `mcpServers` through `mcp.Store`; a name not declared, or whose secret does not resolve (keychain locked), is left out and logged on the Runner's log as `mcp.missing` with the name only; the others go to `StartOptions.MCPServers`.
- **Claude** (`claude.go`): `writeConfig` adds each server to `mcpServers` of `claude/mcp.json` beside `crewdeck` (stdio `{ type: 'stdio', command, args, env }`, HTTP `{ type: 'http', url, headers }`); `--strict-mcp-config` stays, so no server of the Pilote's own Claude configuration is loaded. The file is deleted when the run ends (`Wait` returns), and written again at a resume.
- **Codex** (`apps/runner/internal/engine/codex/`): the Session's `CODEX_HOME/config.toml` gains one `[mcp_servers.<nom>]` table per server (stdio `command`, `args`, `[mcp_servers.<nom>.env]`; HTTP `url`, `http_headers`), appended to what the Session's preparation already wrote there (the Skills' configuration), written mode 600 and deleted when the run ends.
- Tests: `apps/runner/internal/engine/claude/claude_test.go` and `codex/codex_test.go` read the files the fake binary was given (its arguments and the files they name, captured before the end); `apps/runner/internal/session/` with the fake Engine checks which names reach `StartOptions`.

## Decisions already made

- A server mounted is one the Étape attaches and the Runner declares: the Runner never mounts a declared server the message does not name, and never fails a Session for a missing one (ADR 0013: a name the Runner does not declare is a point of the Projet's preparation, PROJET-3, not a Manque).
- The secret values are written only in the Session's own files (mode 600, in its folder of mode 700) for the time of the run, and nowhere else: not in the command line, the log, nor `session.json`.
- No new permission rule: a tool call of a Serveur MCP goes through the Session's mode as every tool (`auto` asks the Pilote through the permission server, `bypass` does not), ADR 0004.
- The name `crewdeck` cannot collide: RUNNER-16 refuses it.

## Acceptance criteria

- [ ] A Session started with `mcpServers: ['stitch']`, two servers declared: Claude's `mcp.json` holds `crewdeck` and `stitch` only, with `stitch`'s env values, mode 600; the arguments keep `--strict-mcp-config`.
- [ ] The same Session on Codex: `config.toml` holds `[mcp_servers.stitch]` and not the other server; an HTTP server is written with `url` and `http_headers`.
- [ ] Once the run ends (normal end, stop, error), neither file exists; a resume writes them again.
- [ ] A name the Runner does not declare: the Session starts without it, the Runner's log names it, no secret appears there.
- [ ] `mcpServers: []`: Claude's `mcp.json` is the permission server alone, as today; no `[mcp_servers]` table for Codex.
- [ ] The fixture of `session.start` with `mcpServers` is valid in TypeScript and Go.

## Verification

- `cd apps/runner && go test ./internal/engine/claude/ ./internal/engine/codex/ ./internal/session/ ./internal/mcp/`
- `pnpm exec nx test contracts -- src/runner/`, `pnpm exec nx test server -- src/sessions/`
- `pnpm exec nx run contracts:generate` with no diff, then `pnpm exec nx affected -t lint typecheck test build --base=origin/develop`

## For prod

Nothing.

## Out of scope

- Declaring the servers and their report: RUNNER-16. Attaching one to an Étape: PROCESS-9.
- Reading the Étape's `mcp` Outils from its Process version when its Session starts: the agent Étapes' start (RUNNER-12).
- The preparation listing attached names the Runner does not declare: PROJET-3.

## Dependencies

- RUNNER-16.
- RUNNER-9.
- RUNNER-6.
