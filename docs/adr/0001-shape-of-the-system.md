# Three apps in one monorepo; the server runs the Process, the Runner runs the agents

> **Status:** accepted, 2026-11-10. Amended by [ADR 0011](0011-the-process-as-data.md)
> on the orchestration: the server interprets each Projet's versioned Process.

## Context

Crewdeck is a hosted product (PRD, « Constraints ») whose agents run on the
**Pilote**'s machine, through the **Runner**, on their own **Comptes IA**.
The **Process** (Idée → Conception → Tickets → Boucle) and its gates are the
product; the screen is a set of **Composants** a **Skin** may replace. The
founder's dotfiles console is the prototype: its sessions host, its
`agent-loop` and its `design` tool already do most of the Process, on one
machine, with files as state.

## Decision

One repository, an Nx 23 monorepo on pnpm (Node 24), with three apps and
three packages:

| Path | What | Stack |
|---|---|---|
| `apps/server` | The API, the real time, the orchestration of the Process, GitHub | NestJS 11, Prisma 7, PostgreSQL 18 |
| `apps/web` | The core of the page (store, router, keys, the product's dialogs) and the PWA | TypeScript, Lit 3 ([ADR 0006](0006-skins-and-composants.md)) |
| `apps/runner` | The **Runner**: drives the **Moteurs**, the worktrees, the Contrat checks | Go ([ADR 0004](0004-the-runner.md)) |
| `packages/contracts` | The single source of every contract: API, events, Runner protocol, **Contrats**, Composants | zod 4, generating JSON Schema and Go types |
| `packages/sdk` | What a **Skin** may import: the Composants' contracts, the data and actions bridge | TypeScript |
| `packages/skin-passerelle` | The default **Skin** (`design/DESIGN.md`) | Lit 3, `cd-*` custom elements |

- **The server orchestrates.** It holds the state machine of the Process:
  Idées' triage, Conceptions, Tickets, the **Boucle** of each **Projet**,
  **Planifications**, **Décisions**, the Runner's presence. It decides what
  runs next and asks the Runner to start a **Session**; it merges.
- **The Runner executes.** It starts one **Session** per **Étape** on demand,
  streams its events (encrypted, [ADR 0003](0003-privacy-and-end-to-end-encryption.md)),
  checks the output against the **Contrat** ([ADR 0005](0005-contrats-as-data.md))
  and reports a verdict. It keeps no Process state: restarted, it asks the
  server what it was doing.
- **One server process at the MVP.** Fan-out of events is in memory,
  PostgreSQL is the truth. A second process (the Bêta's load) adds
  PostgreSQL `LISTEN/NOTIFY`, not Redis.
- **Contracts are generated, never copied.** `packages/contracts` exports
  zod schemas; `nx run contracts:generate` writes their JSON Schema
  (`z.toJSONSchema`) and the Go types of `apps/runner/internal/contracts`
  (go-jsonschema). Shared fixtures (`packages/contracts/fixtures/`) are
  validated by the TypeScript and Go tests both; CI fails when the generated
  files are not up to date.

## Options that lost

- **The Runner runs the Boucle locally** (like `agent-loop`): a
  **Planification** and « Runner hors ligne » need someone awake, and the
  state would be split between the machine and the server.
- **The Runner in TypeScript** (`bun build --compile`): one language less,
  but a Runner in Go is a small static binary with the crypto in its
  standard library, the founder's choice; the generated contracts pay for
  the second language.
- **Turborepo or plain workspaces**: personal-os's CI, `worktree.sh` and
  their lessons are Nx's; Go projects join the graph through `project.json`
  targets.
- **Hono and Drizzle** (the console's): every convention of personal-os's
  ADR 0030 (validation pipe, error envelope, scope guard, test baseline)
  would be rewritten.

## Consequences

- Nx knows Go through `apps/runner/project.json` (`nx:run-commands` targets
  `test`, `lint`, `build`, inputs `**/*.go`, `go.mod`, `go.sum`) with an
  implicit dependency on `contracts`: `nx affected` covers the Runner.
- The first files to imitate, created by the walking skeleton:
  `packages/contracts/src/api/projects.ts` (a resource's schemas),
  `packages/contracts/src/runner/session.ts` (a protocol message),
  `apps/server/src/projects/` (a module), `apps/runner/internal/session/`
  (a Session's lifecycle).
