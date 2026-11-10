---
id: CONCEPTION-7
title: "Conception technique Étape: the official technical-design Skill and its Contrat"
epic: CONCEPTION
type: feature
priority: P1
size: M
milestone: M6 Conception
blocked_by: [CONCEPTION-4]
adr: [0004, 0005]
risques: [IA-6]
stories: [US-11, US-48]
screens: []
revue_visuelle: false
video: false
---

## Context

After the PRD (and the mockups when there are some), the Rôle Conception runs the technical design with the Pilote: what lets coding agents implement the Projet without asking (AGENTS.md, ADRs, glossary, risk register), checked against the Conception technique Contrat (ADR 0005), opened as a design PR reviewed on CONCEPTION-4's page. The Skill is ported from the dotfiles `technical-design` skill (`MaximeD1412/dotfiles`, `agents/skills/technical-design/SKILL.md` and `REFERENCE.md`).

## Current state of the code

- Created by CONCEPTION-3: the document lifecycle (`apps/server/src/designs/documents.ts`), the PR verb with `--label`, the Contrat's `{path}` variables.
- Created by CONCEPTION-4: the review page `/conceptions/:id/relecture/:step` (with `technical-design`: AGENTS.md, then the ADRs, then `CONTEXT.md`), `approve`, `request-changes`; the approval of the PRD or of the mockups starts this Étape through `nextStep`.
- Created by RUNNER-11 / RUNNER-12: Contrats, `check` functions, embedded Skills.
- No technical-design Skill, no `technical-design` Contrat.

## To do

- **Skill** `apps/runner/skills/technical-design/` (`SKILL.md`, `REFERENCE.md`), ported: argument the PRD's path; the inventory of what is decided, closed question rounds with a recommendation (`AskUserQuestion`), AGENTS.md with its sections (The repo, Conventions with Language and From domain to code, Deciding alone, Checking, Delivering a ticket, Pilotage files), ADRs `docs/adr/NNNN-<slug>.md` with their status line, `CONTEXT.md`, `docs/pilotage/risques.json`, the design journal `docs/design-journal.md`; the design PR on branch `chore/technical-design` (or `chore/<topic>` for a feature) into the integration branch, title `docs(design): conception technique de <title>`, label `conception`; `crewdeck-runner etape report` with `{ prNumber, branch, headSha, adrCount }`. Its own cross review is removed (CONCEPTION-8's Étape); `design start`/`watch` replaced by `crewdeck-runner etape`. `--fix <commentId>` as the other documents.
- **Contrat** `packages/contracts/src/contrats/technical-design.ts`, version 1, ADR 0005's row:
  - `technical-design.agents.sections` (`sections` of `AGENTS.md`: the six above, as `## ` headings in order; a French AGENTS.md keeps its names, so the rule accepts the list of `packages/contracts/src/contrats/agents-sections.ts` in either language), « AGENTS.md a ses sections »;
  - `technical-design.adr.status` (`pattern` on `docs/adr/*.md`: a line `> **Status:** <state>, <YYYY-MM-DD>.` or `> **Statut :** …`), « Chaque ADR a sa ligne de statut »;
  - `technical-design.risks` (`json` `docs/pilotage/risques.json` against `zRiskRegister` in `packages/contracts/src/pilotage/risks.ts`: `categories`, `statuts`, `risques[{ id, categorie, gravite, titre, statut, statutDepuis, solutions[{ texte, ref, fait }], tickets }]`), « risques.json est valide »;
  - `technical-design.glossary.identifiers` (`check` `glossary-identifiers`, `checks/glossary_identifiers.go`): every bold term of `CONTEXT.md`'s « Language » section is followed by its code identifier in backticks, « Chaque terme du glossaire a son identifiant de code »;
  - `technical-design.pr` (`pr`: base the integration branch, label `conception`).
  - Fixtures passing and failing per rule (this repository's own `AGENTS.md`, `docs/adr/` and `CONTEXT.md` are a passing fixture copied into `testdata/technical-design/pass/`).
- **Server**: the report fills the `DesignStep` through `documents.ts`; the Décision reads « Conception à relire · Conception technique « <title> » », context « N ADR ».

## Decisions already made

- The Contrat checks the shape the dotfiles skill writes (its REFERENCE.md), not the content's quality: the cross review (CONCEPTION-8) and the Pilote judge that.
- A Projet that already has a technical design (a feature Conception) changes AGENTS.md and adds ADRs on the same branch rules; the Contrat runs on the whole files, not only the diff.

## Acceptance criteria

- [ ] After the mockups' approval (or the PRD's without mockups), the `technical-design` Étape starts; a passing report makes it `ready` and raises « Conception à relire · Conception technique « … » ».
- [ ] An ADR without its status line fails `technical-design.adr.status`; a glossary term without its identifier fails `technical-design.glossary.identifiers`; this repository's own design passes every rule (Go fixtures).
- [ ] The review page shows AGENTS.md first, then the ADRs, then CONTEXT.md, for this Étape.

## Verification

- `cd apps/runner && go test ./internal/contrat/... -run TechnicalDesign`
- `pnpm exec nx test contracts -- src/contrats/technical-design.spec.ts src/pilotage/risks.spec.ts`
- `pnpm exec nx run contracts:generate` with no diff; `pnpm exec nx affected -t lint typecheck test build --base=origin/develop`

## For prod

Nothing.

## Out of scope

- The cross review of the technical design: CONCEPTION-8.
- The console's Pilotage page drawn from `docs/pilotage/` (`setup-pilotage`): US-64 (Lancement).

## Dependencies

- CONCEPTION-4.
