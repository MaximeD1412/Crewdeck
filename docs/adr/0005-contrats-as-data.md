# Each Contrat is data, checked by the Runner

> **Status:** accepted, 2026-11-10.

## Context

Every **Étape**'s output is checked against its **Contrat**, and an
incomplete or failed one raises a **Décision** to run it again (US-48). The
**Skill** that does the work can be replaced later (US-49), never the
**Contrat** nor the gates. PR #5 left « what each Contrat checks » to this
design. The server never reads the content ([ADR 0003](0003-privacy-and-end-to-end-encryption.md)),
the Runner is in Go ([ADR 0004](0004-the-runner.md)), and the dotfiles
already check most outputs with scripts (`check-backlog.mjs`, `design
screens`).

## Decision

- **A Contrat is a declaration**, `packages/contracts/src/contrats/<step>.ts`:
  an id, a version, the **Étape** it belongs to, and its rules. A rule has a
  stable id (`prd.stories.unique`), a French label shown to the **Pilote**
  (« Chaque story a un identifiant unique »), a severity (`bloquant` or
  `attention`) and a kind with its parameters:
  - `file` (a path or a glob exists),
  - `sections` (the headings a Markdown file must have, in order),
  - `pattern` (lines that must match a regex, with a unique capture),
  - `front-matter` (a YAML header matching a JSON Schema),
  - `json` (a file matching a JSON Schema),
  - `pr` (the Étape's PR: base, branch name, body patterns, label),
  - `check` (a named Go function, for what data cannot say).
- `contracts:generate` writes them to JSON, embedded in the Runner
  (`go:embed`). The Runner interprets them on the Étape's worktree and its
  PR, then sends the verdict: the Contrat's id and version, `passed` or
  `incomplete`, and the ids of the failed rules. The server and the page
  show the labels from the same declarations: the content never travels.
- **A `check` function** lives in `apps/runner/internal/contrat/checks/`,
  one file per name, with its tests. A new kind of rule is preferred over a
  new function as soon as two Contrats need it.
- **Failures** (US-48): an `incomplete` verdict raises « Contrat
  incomplet » (the failed labels, « Relancer l'Étape »); a Session that
  ends in error or is stopped by the Runner raises « Étape échouée » (same
  action). An **Idée** whose analysis failed stays open to triage.

## The MVP's Contrats

| Étape | Output | Blocking rules |
|---|---|---|
| Analyse d'une Idée | A JSON report through `crewdeck-runner etape report` (encrypted before it leaves the Runner) | summary present and at most 400 characters; target **Projet** one of the Pilote's or `nouveau`; impact and effort from 1 to 5, each with its reason; duplicates are ids of open Idées |
| PRD | `docs/product/prd.md` or `docs/product/features/<slug>.md`, its design PR | the PRD's sections; stories `- **US-<n>** (MVP\|next\|later) As a …` with unique ids; no id of the base branch removed or reused; every story in « Scope »; `CONTEXT.md` present; PR to the integration branch with the label `conception` |
| Maquettes | `design/DESIGN.md`, `design/screens.json`, the captures | `screens.json` valid; every screen and state has its capture at 390 and 1280 px; every story cited exists in the PRD |
| Conception technique | `AGENTS.md`, `docs/adr/`, `CONTEXT.md`, `docs/pilotage/risques.json` | AGENTS.md's sections; every ADR has its status line; `risques.json` valid; every glossary term has its code identifier |
| Découpage en Tickets | `backlog/` files, then the issues | the ticket template's front matter; every story cited exists; every `MVP` story has a ticket (`attention`); no cycle in `blocked-by`; acceptance criteria present (the rules of `plan-backlog`'s `check-backlog.mjs`) |
| Code | The Ticket's PR | branch `(feat\|fix\|chore)/<n>-<slug>` to the integration branch; « Closes #n »; the criterion-to-test table; for a Ticket with a visual review, its captures at 390 and 1280 px linked |
| Review | A PR review of kind `COMMENT` | a verdict `ok` or `changements`; each remark has a file and line or says it is general |
| Revue croisée | The remarks and their answers | every remark answered, fixed or « non retenue » with a reason |

The checks (CI) are not a Contrat: they are a gate the Boucle reads from
GitHub.

## Options that lost

- **TypeScript checkers inside the Runner** (an embedded JS engine): the
  second language we just ruled out, and checkers the product cannot show.
- **Checks on the server**: it would read the content.
- **An AI judge**: neither reproducible nor free; the Review is already an
  agent.

## Consequences

- A **Moddeur**'s Skill (Lancement) is written against the same
  declarations: the Contrat is its specification.
- Changing a rule changes the Contrat's version; the verdict carries it, so
  an old verdict stays readable.
