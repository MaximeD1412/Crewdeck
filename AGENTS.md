# Crewdeck: instructions for agents

Crewdeck is a hosted product where a solo developer (the **Pilote**) drives
their projects with AI agents through a fixed **Process** (Idée →
Conception → Tickets → Boucle), in real time, through an interface a
**Skin** may reshape. Read, before any ticket:

- the PRD, [`docs/product/prd.md`](docs/product/prd.md) (stories `US-<n>`,
  cited by the tickets);
- the glossary, [`CONTEXT.md`](CONTEXT.md): its terms are used as spelled,
  in the UI and, through their identifiers, in the code;
- the decisions, [`docs/adr/`](docs/adr/): a ticket never reopens one;
- the mockups, [`design/DESIGN.md`](design/DESIGN.md) and
  [`design/screens.json`](design/screens.json), for any screen. They are a
  reference, never imported.

## The repo

An Nx monorepo on pnpm (Node 24) with a Go app ([ADR 0001](docs/adr/0001-shape-of-the-system.md)).
Toolchain versions are in `.mise.toml` (`mise install`).

| Path | What |
|---|---|
| `apps/server` | NestJS API, real time, orchestration of the Process, GitHub App; Prisma and PostgreSQL |
| `apps/web` | The core of the page (store, router, keys, the product's dialogs), the PWA |
| `apps/runner` | The **Runner**, in Go: Moteur adapters, worktrees, Contrat checks, embedded official Skills |
| `packages/contracts` | Every schema (zod): API, events, Runner protocol, Contrats, Composants; generates JSON Schema and Go types |
| `packages/sdk` | What a Skin may import: contracts of the Composants, the bridge, `t()`, formatters |
| `packages/skin-passerelle` | The default Skin, Lit custom elements `cd-*` |
| `infra/` | `provision/`, `deploy/`, `backup/`, `edge/` |
| `scripts/` | `worktree.sh`, `captures.sh` |
| `design/` | The mockups (code), never imported |
| `backlog/` | The tickets' files; GitHub is the source of truth once created |
| `docs/pilotage/` | The console's « Pilotage » page for this repository |

- Integration branch `develop`, release branch `main`. Tickets branch from
  `develop` and merge into it.
- Run locally: `pnpm db:up` (PostgreSQL in Docker), `pnpm dev` (server and
  web against the fake Runner and the fake GitHub), `pnpm exec nx run
  runner:run -- --server http://localhost:3000` for a real Runner.

## Conventions

The how-to is here; the why is in the ADRs.

- **Shape**: the server orchestrates, the Runner executes, the contracts
  are generated ([0001](docs/adr/0001-shape-of-the-system.md)). After
  changing a schema of `packages/contracts`: `pnpm exec nx run
  contracts:generate`, and commit what it writes.
- **GitHub**, when a Projet uses it, through the App only ([0002](docs/adr/0002-github-app.md)): the
  server never reads a file nor a diff outside its allowlist; the page reads
  content from GitHub with the user token.
- **Privacy** ([0003](docs/adr/0003-privacy-and-end-to-end-encryption.md)):
  what the server may read is in its table. A new field of free text from
  the Pilote or an agent is encrypted; when in doubt, it is.
- **Runner** ([0004](docs/adr/0004-the-runner.md)): Moteur adapters behind
  one interface, recorded streams for tests, official Skills embedded.
- **Contrats** are data ([0005](docs/adr/0005-contrats-as-data.md)); a new
  `check` function only when no rule kind fits.
- **Composants**: data in, `cd-action` out, Emplacements as slots, shadow
  DOM and `--cd-*` tokens ([0006](docs/adr/0006-skins-and-composants.md)).
  A Skin imports only `@crewdeck/sdk`.
- **Real time**: every change writes its event in the same transaction
  ([0007](docs/adr/0007-real-time.md)); pages never poll.
- **API, errors, lists, dates, money, scope, front data, tests**:
  [0008](docs/adr/0008-conventions.md). Copy its « first files to imitate ».
- **Infra and delivery**: [0009](docs/adr/0009-infra-and-delivery.md).
- **Miroir**: the Runner's copy of every Source and of the documents, the
  agents' one channel: they read with `crewdeck-runner miroir`, and write
  with it too (`miroir issue|pr create|comment|review|close…`), never with
  `gh` in an official Skill; the server forwards content-free
  `github.changed` events ([0010](docs/adr/0010-the-runners-miroir.md),
  [0012](docs/adr/0012-sources-local-and-github.md)).
- **Process**: a Projet's Process is a versioned `ProcessDefinition`
  interpreted by the server's engine; nothing in the code assumes the
  default Phases. A rule of the canvas (an arrow, a Manque) is a pure
  function of `packages/contracts/src/process/`, run by the page and the
  server alike; a new Étape is a `kind` of the catalogue and its handler in
  `apps/server/src/process/engine/kinds/`
  ([0011](docs/adr/0011-the-process-as-data.md)).
- **Sources**: every feature works on a Local Projet as on a GitHub one;
  a Source-specific path goes behind `apps/runner/internal/source/<source>/`.
  A Local Projet's texts reach the server sealed, its content only through
  the relay ([0012](docs/adr/0012-sources-local-and-github.md)).
- **Commandes and Serveurs MCP** run on the Runner; a Commande's text is
  sealed and only the Runner opens it
  ([0013](docs/adr/0013-commandes-and-serveurs-mcp.md)).
- **Sign-in**: email link, Google or GitHub; GitHub is never assumed
  linked ([0014](docs/adr/0014-sign-in-without-github.md)).

### Language

English for code, comments, routes, schemas, logs, docs, ADRs and tickets'
technical content. French for the UI copy (through `t()`, never inline),
the error messages, the Contrats' labels, the commits and the PRs. Page
URLs are French (`/a-toi`, `/idees`), API paths English.

### From domain to code

| Glossary | Code | Where |
|---|---|---|
| **Pilote** | `Pilot` | `apps/server/src/pilots/`, scope `pilotId` everywhere |
| **Projet** / **Dépôt GitHub** | `Project` / `Repository` | `apps/server/src/projects/`, `apps/server/src/github/` |
| **Idée** | `Idea` | `apps/server/src/ideas/` (ciphertext), `/idees` |
| **Conception** | `Design` | `apps/server/src/designs/`, `/conceptions` |
| **Étape** / **Contrat** | `Step` / `StepContract` | `packages/contracts/src/contrats/`, `apps/runner/internal/contrat/` |
| **Ticket** | `Ticket` | `apps/server/src/tickets/` (a GitHub issue) |
| **Boucle** / **Planification** | `AgentLoop` / `Schedule` | `apps/server/src/loops/`, `apps/server/src/schedules/`, `/boucle` |
| **Session** | `AgentSession` | `apps/server/src/sessions/` (state), `apps/runner/internal/session/` (content) |
| **Décision** | `Decision` | `apps/server/src/decisions/`, `/a-toi` |
| **Runner** / **Moteur** / **Compte IA** / **Rôle** | `Runner` / `Engine` / `AiAccount` / `AgentRole` | `apps/server/src/runners/`, `apps/runner/internal/engine/` |
| **Miroir** | `Mirror` | `apps/runner/internal/mirror/`, `crewdeck-runner miroir` |
| **Process** / **Phase** / **Modèle de process** | `Process` (`ProcessDefinition`, `ProcessVersion`, `ProcessDraft`) / `Phase` / `ProcessTemplate` | `packages/contracts/src/process/`, `apps/server/src/process/` |
| **Gestion du process** | `ProcessEditor` | `/projets/:id/process` |
| **Entrée** / **Sortie** / **Type d'artefact** / **Retour** / **Manque** | `StepInput` / `StepOutput` / `ArtifactType` / `LoopBack` / `ProcessGap` | `packages/contracts/src/process/` |
| **Étape du produit** | `CoreStep` (`checks`, `merge`) | `apps/server/src/process/engine/kinds/` |
| **Source** / **Local** / **Connecteur** | `Source` / `LocalSource` / `Connector` | `apps/server/src/process/sources/`, `apps/runner/internal/source/` |
| **Commande** / **Serveur MCP** | `Command` / `McpServer` | `apps/runner/internal/command/`, `apps/runner/internal/mcp/`, `crewdeck-runner mcp` |
| **Identité** | `PilotIdentity` | `apps/server/src/auth/` |
| **Appareil** | `Device` | `apps/web/src/keys/`, `apps/server/src/devices/` |
| **Inventaire** | `Inventory` | `apps/server/src/projects/inventory/` |
| **Revue visuelle** / **Revue croisée** | `VisualReview` / `CrossReview` | `apps/server/src/reviews/` |
| **Paramètres** | `Settings` | `apps/server/src/settings/`, `/parametres` |
| **Composant** / **Skin** / **Emplacement** / **Cadre** | `Component` / `Skin` / `Slot` / `Shell` | `packages/contracts/src/composants/`, `packages/skin-passerelle/` |
| **Action sensible** | `SensitiveAction` | `apps/web/src/dialogs/confirm.ts`, `apps/server/src/sensitive-actions/` |
| **Resynchronisation** | `Resync` | `apps/web/src/store/` |

## Deciding alone

- A question that does not change what the Pilote sees or does (a name, a
  file's place, a helper, an index): decide, and say it in the PR.
- One that does, or a ticket that contradicts an ADR, the PRD, the glossary
  or the mockups: stop, write why (`blocked.md` under agent-loop, else a
  comment on the ticket) and label it `needs-human`.
- Never against a real system: no call to GitHub, a provider or the VPS
  from a test or a script; no secret, email or machine path in a committed
  file or a fixture. A ticket that needs one is `type: externe`.

## Checking

Run what the change touches, from the repo's root:

| What | Command |
|---|---|
| One TypeScript test file | `pnpm exec nx test server -- src/ideas/ideas.service.spec.ts` (or `web`, `contracts`, `sdk`, `skin-passerelle`) |
| One integration file | `pnpm exec nx test-integration server -- ideas` (needs `pnpm db:up`) |
| One end-to-end spec | `pnpm exec nx e2e web -- a-toi.spec.ts` (needs `pnpm db:up`; starts `pnpm dev`, or reuses it; a screen adds its scenario in `apps/server/src/testing/scenarios/` and its spec in `apps/web/e2e/`) |
| One Go package | `cd apps/runner && go test ./internal/session/ -run TestResume` |
| Before the PR | `pnpm exec nx affected -t lint typecheck test build --base=origin/develop`, the integration and e2e files of what you touched, `pnpm exec nx run contracts:generate` with no diff |

Never the whole integration or e2e suite locally: CI and the nightly run
them. A red nightly is fixed before anything else. What CI runs, and its one
required check « ci »: [`docs/ci.md`](docs/ci.md).

What every piece must prove: the test baseline of
[ADR 0008](docs/adr/0008-conventions.md#test-baseline) (routes, events,
Composants, screens, adapters, Contrat rules, protocol messages).

## Delivering a ticket

- Branch `feat/<n>-<slug>` (or `fix/`, `chore/`) from `develop`; commits
  `<type>(<scope>) : <message>` in French.
- The PR goes to `develop`, as a draft until its own checks pass. Body in
  French: what changed, « Closes #<n> », the criterion-to-test table (each
  acceptance criterion, the test that proves it), the decisions taken alone.
- A ticket with `revue_visuelle: true`: `scripts/captures.sh <scenario>…`
  with the scenarios of each screen and state it changes (their names are
  the ids of `design/screens.json`, `<id>` or `<id>-<state>`; 390 and 1280
  px, pushed to `captures/<n>`), the
  captures in the PR body, label `revue-visuelle`; a ticket with
  `video: true` adds a video of the flow. The merge waits for the Pilote.
- Done means: the acceptance criteria proven by tests, the checks green,
  the pilotage files updated, nothing left in `TODO` without a ticket.

## Pilotage files

The console's « Pilotage » page reads `docs/pilotage/` on `origin/develop`.
A ticket's PR updates:

- `risques.json` when the ticket handles a risk it cites (`risques:`): tick
  the solutions done, move the status, date it in `statutDepuis`;
- `mep.json` for what the VPS or an account needs once merged (a secret, a
  setting of the GitHub App), one element per need with the ticket's id;
- `architecture.json` only when a block (app, service, external system) is
  added or removed.

## Working beside other sessions

Several sessions work on this repository at once; the main checkout is
never edited.

- Work in a worktree (`../Crewdeck-<branch>`): `scripts/worktree.sh setup`
  in it after `git worktree add` (the `.env*` of the main checkout, the
  toolchain, the dependencies, the shared PostgreSQL), `scripts/worktree.sh
  drop` before `git worktree remove`.
- Commit with explicit paths, never `git add -A` nor `git commit -a`.
